import assert from 'node:assert/strict'
import { it } from 'vitest'
import { TURN_UNDO_ORDER } from '../src/client/constants'
import { registerTurnUndo } from '../src/client/register/turn-action'
import { resolveCommandRunner, selectTurnForMessage, turnForMessageNode, turnIdFor, undoCommandLine } from '../src/client/utils/turn-action'

const translate = key => `[${key}]`

it('builds the ledger turn id from the session id and the slot turn number', () => {
  // 账本 turn id 与宿主事件一致：<sessionId>:<turn>。
  assert.equal(turnIdFor('sess-1', 7), 'sess-1:7')
  assert.equal(turnIdFor('sess-1', '7'), 'sess-1:7')
  assert.equal(turnIdFor('sess-1', 0), 'sess-1:0')
})

it('refuses to target a turn without a usable session id or turn number', () => {
  assert.equal(turnIdFor(null, 3), null)
  assert.equal(turnIdFor('', 3), null)
  assert.equal(turnIdFor('sess-1', undefined), null)
  assert.equal(turnIdFor('sess-1', 'turn-3'), null)
  assert.equal(turnIdFor('sess-1', 1.5), null)
  assert.equal(turnIdFor('sess-1', -1), null)
  assert.equal(turnIdFor('sess-1', Number.NaN), null)
})

it('submits the same command line a human would type', () => {
  assert.equal(undoCommandLine('sess-1:7'), '/undo sess-1:7')
})

it('maps a chat node payload back to its turn number', () => {
  // turn-tail 节点：closing.finalNode.messageId + data.turn。
  assert.equal(turnForMessageNode({ data: { turn: 3, closing: { finalNode: { messageId: 'm-3' } } } }, 'm-3'), 3)
  // assistant 节点：finalNode.messageId（或扁平 messageId）。
  assert.equal(turnForMessageNode({ data: { turn: 2, finalNode: { messageId: 'm-2' } } }, 'm-2'), 2)
  assert.equal(turnForMessageNode({ data: { turn: 1, messageId: 'm-1' } }, 'm-1'), 1)
  // 不匹配 / 缺 turn 号 / 形状不符：一律 null，绝不误定位到别的 turn。
  assert.equal(turnForMessageNode({ data: { turn: 3, closing: { finalNode: { messageId: 'other' } } } }, 'm-3'), null)
  assert.equal(turnForMessageNode({ data: { closing: { finalNode: { messageId: 'm-3' } } } }, 'm-3'), null)
  assert.equal(turnForMessageNode({ data: { turn: 1.5, messageId: 'm-1' } }, 'm-1'), null)
  assert.equal(turnForMessageNode({ data: null }, 'm-1'), null)
  assert.equal(turnForMessageNode(null, 'm-1'), null)
})

it('reads the turn number off the conversation snapshot (order + keyed reader)', () => {
  const nodes = new Map([
    ['tail-3', { data: { turn: 3, closing: { finalNode: { messageId: 'm-3' } } } }],
    ['tail-4', { data: { turn: 4, closing: { finalNode: { messageId: 'm-4' } } } }],
  ])
  const snapshot = { chat: { order: ['tail-3', 'tail-4'], nodes: { get: key => nodes.get(key) } } }
  assert.equal(selectTurnForMessage(snapshot, 'm-4'), 4)
  assert.equal(selectTurnForMessage(snapshot, 'm-missing'), null)
})

it('falls back to the legacy node list and never throws on unknown shapes', () => {
  const snapshot = { chat: { legacy: { nodes: [{ kind: 'assistant', messageId: 'm-9', turn: 9 }] } } }
  assert.equal(selectTurnForMessage(snapshot, 'm-9'), 9)

  // 宿主版本差异：形状不符时按钮只是不渲染，绝不能让 apply/渲染抛。
  assert.equal(selectTurnForMessage(undefined, 'm-1'), null)
  assert.equal(selectTurnForMessage({}, 'm-1'), null)
  assert.equal(selectTurnForMessage({ chat: {} }, 'm-1'), null)
  assert.equal(selectTurnForMessage({ chat: { order: 'nope', nodes: {} } }, 'm-1'), null)
  assert.equal(selectTurnForMessage(snapshot, undefined), null)
  assert.equal(selectTurnForMessage(snapshot, ''), null)
  // nodes.values() 兜底路径。
  const values = { chat: { nodes: { values: () => [{ data: { turn: 5, messageId: 'm-5' } }] } } }
  assert.equal(selectTurnForMessage(values, 'm-5'), 5)
})

it('registers into the assistant action strip as a list entry, not the turnTail chain', () => {
  // 回归护栏：turnTail 是选择器路由的 chain 槽位，每处只渲染第一个命中的注册，
  // 而核心 ui-deliverables 已占位且「产出过文件」就命中——最需要撤销的场景。
  const seen = []
  const disposers = []
  const host = {
    slots: {
      inject(slot, factory) {
        seen.push({ slot })
        const dispose = factory()
        disposers.push(dispose)
        return dispose
      },
      register(options) {
        seen.push({ options })
        return () => {}
      },
    },
  }
  const dispose = registerTurnUndo(host)
  assert.equal(typeof dispose, 'function')
  assert.equal(seen[0].slot, 'conversation.chat.assistant-actions')
  assert.deepEqual(seen[1].options, {
    name: 'conversation.chat.assistant-actions',
    id: 'turnrewind-undo',
    order: TURN_UNDO_ORDER,
    locale: 'dsh-tauri-turnrewind',
  })
  // list 槽位上没有 select（那是 chain 的注册字段），有 select 就说明用错了槽位。
  assert.equal('select' in seen[1].options, false)
})

it('resolves the command runner only when the host exposes remote.commands.execute', () => {
  assert.equal(resolveCommandRunner({}, translate), null)
  assert.equal(resolveCommandRunner({ remote: {} }, translate), null)
  assert.equal(resolveCommandRunner({ remote: { commands: { execute: 'nope' } } }, translate), null)
  assert.equal(typeof resolveCommandRunner({ remote: { commands: { execute: async () => {} } } }, translate), 'function')
})

it('degrades to null when the cordis proxy rejects the property access', () => {
  // 未在 inject 里声明 remote 时，cordis 的 context 代理读该属性会直接抛。
  // 这个抛绝不能冒泡到 apply（线上表现为整个客户端插件 "Failed to load plugins"）。
  const throwing = new Proxy({}, {
    get(_target, key) {
      throw new Error(`cannot get property "${String(key)}" without inject`)
    },
  })
  assert.equal(resolveCommandRunner(throwing, translate), null)
})

it('runs the command against the given session and surfaces host failures', async () => {
  const calls = []
  const ctx = {
    remote: {
      commands: {
        async execute(sessionId, line, images) {
          calls.push({ sessionId, line, images, self: this })
          if (line.includes('boom'))
            throw new Error('TURNREWIND_BOOM')
        },
      },
    },
  }
  const run = resolveCommandRunner(ctx, translate)
  assert.ok(run)

  // 成功路径：调用宿主、返回 null、images 恒为空数组。
  assert.equal(await run('/undo sess-1:7', 'sess-1'), null)
  assert.deepEqual(calls[0], { sessionId: 'sess-1', line: '/undo sess-1:7', images: [], self: ctx.remote.commands })

  // 会话缺失：不发命令，直接返回既有文案。
  assert.equal(await run('/undo sess-1:7', null), translate('sessionMissing'))
  assert.equal(calls.length, 1)

  // 宿主抛错：把错误文本交回按钮显示。
  assert.equal(await run('/undo boom', 'sess-1'), 'TURNREWIND_BOOM')
})
