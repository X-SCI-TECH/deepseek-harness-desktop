import assert from 'node:assert/strict'
import { it } from 'vitest'
import { resolveCommandRunner, turnIdFor, undoCommandLine } from '../src/client/utils/turn-action'

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
