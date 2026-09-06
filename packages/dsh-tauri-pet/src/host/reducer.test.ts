import type { PetSessionEvent, PetSessionPeer } from './reducer'
/**
 * src/host/reducer.test.ts — reducer（会话增量 → 桌宠展示态）单测。
 *
 * 输入是真实 `SessionEvent` 形状（{type, seq, time, data}），reducer 的输出
 * 必须与 use-bubble.ts 期望的展示态字段（status/running/liveActivity/message/…）
 * 一致。重点覆盖：running 生命周期翻转、展示态去重、子代理 origin 透传。
 */
import { describe, expect, it } from 'vitest'
import {
  createPetSessionReducer,
  PET_REASONING_PUSH_INTERVAL_MS,
  PET_REASONING_TAIL_WINDOW,

} from './reducer'

function ev(type: string, data: Record<string, unknown>, seq: number): PetSessionEvent {
  return { type, seq, time: Date.now(), data }
}

const peer = (over: Partial<PetSessionPeer> = {}): PetSessionPeer => ({ id: 'a', ...over })

/** 收集 reducer 产生的 (action, payload) 序列。 */
function collect(opts?: { now?: () => number }) {
  const pushes: Array<{ action: string, payload: Record<string, unknown> }> = []
  const reducer = createPetSessionReducer((action, payload) => {
    pushes.push({ action, payload: payload as unknown as Record<string, unknown> })
  }, opts)
  return { reducer, pushes }
}

describe('petSessionReducer (host)', () => {
  it('create 时发出 running=false、status 无的 create payload', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    expect(pushes).toHaveLength(1)
    expect(pushes[0].action).toBe('create')
    expect(pushes[0].payload).toMatchObject({ id: 'a', running: false })
    expect(pushes[0].payload.status).toBeUndefined()
  })

  it('turn/start 让 running=true、status=running', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    const last = pushes.at(-1)!
    expect(last.action).toBe('update')
    expect(last.payload).toMatchObject({ id: 'a', running: true, status: 'running' })
  })

  it('assistant/chunk(reasoning-delta) 累积出 liveActivity=reasoning', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: '思考' } }, 2))
    const last = pushes.at(-1)!
    expect(last.payload).toMatchObject({ running: true, status: 'running' })
    expect(last.payload.liveActivity).toMatchObject({ kind: 'reasoning', text: '思考' })
  })

  it('tool/call 时 liveActivity 切换为工具名（携带 args），tool/result 后清空', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: '思考' } }, 2))
    reducer.apply(peer(), ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"ls"}' }, 3))
    const toolPush = pushes.at(-1)!
    expect(toolPush.payload.liveActivity).toMatchObject({ kind: 'tool', name: 'pwsh', args: '{"command":"ls"}' })
    // tool/result 结束 c1，openTools 清空；reasoning 仍在 → 回到 reasoning。
    reducer.apply(peer(), ev('tool/result', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'ok' }] } }, 4))
    const afterResult = pushes.at(-1)!
    expect(afterResult.payload.liveActivity).toMatchObject({ kind: 'reasoning', text: '思考' })
  })

  it('approval/asked 让展示为 waiting(phase=approval)，approval/decided 后清除', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('approval/asked', { id: 'ap1', toolName: 'plan_final_approval' }, 2))
    const asked = pushes.at(-1)!
    expect(asked.payload).toMatchObject({ running: true, status: 'waiting', phase: 'approval' })
    // 相同 id 的 decided 清除等待态；running 仍在 → 回到 running。
    reducer.apply(peer(), ev('approval/decided', { id: 'ap1' }, 3))
    const decided = pushes.at(-1)!
    expect(decided.payload.status).toBe('running')
    expect(decided.payload.phase).toBeUndefined()
  })

  it('user-question 工具调用让展示为 waiting(phase=user-question)，user/message 应答后清除', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('tool/call', { turn: 1, step: 1, callId: 'uq1', name: 'ask_user_question', arguments: '{}' }, 2))
    const waiting = pushes.at(-1)!
    expect(waiting.payload).toMatchObject({ running: true, status: 'waiting', phase: 'user-question' })
    // 用户应答后（user/message）清除等待态。
    reducer.apply(peer(), ev('user/message', { turn: 1, message: { role: 'user', content: [{ type: 'text', text: '继续' }] } }, 3))
    const afterAnswer = pushes.at(-1)!
    expect(afterAnswer.payload.status).toBe('running')
    expect(afterAnswer.payload.phase).toBeUndefined()
  })

  it('turn/end(blocked) 让展示为 waiting(phase=blocked)（等待用户处理非思考中）', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('turn/end', { turn: 1, reason: { kind: 'blocked' } }, 2))
    const last = pushes.at(-1)!
    expect(last.payload).toMatchObject({ running: false, status: 'waiting', phase: 'blocked' })
  })

  it('turn/end(completed) 把 running 翻回 false、status 清空', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'x' } }, 2))
    reducer.apply(peer(), ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
    const last = pushes.at(-1)!
    expect(last.payload).toMatchObject({ id: 'a', running: false })
    expect(last.payload.status).toBeUndefined()
    expect(last.payload.liveActivity).toBeUndefined()
  })

  it('turn/end(error) 记录 lastAgentError → status=error', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { message: 'boom' } },
    }, 2))
    const last = pushes.at(-1)!
    expect(last.payload).toMatchObject({ running: false, status: 'error', lastAgentError: 'boom' })
  })

  it('展示态未变化时不重复转发（去重，防 #396 高频转发）', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    const beforeDup = pushes.length
    // 相同 seq 的 turn/start 再喂一次（复制），展示态不变 → 不产生 update。
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    expect(pushes.length).toBe(beforeDup)
  })

  it('reasoning-delta 滚动尾部窗口：超出窗口丢弃最早内容并继续实时更新', () => {
    // 注入可控时钟：跨越窗口推一条，再推进时间推一条（节流窗口外才推送）。
    let t = 0
    const { reducer, pushes } = collect({ now: () => t })
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    // 喂一个跨越窗口长度的 reasoning 增量：前段被挤掉，只保留尾部。
    const front = 'a'.repeat(PET_REASONING_TAIL_WINDOW + 50)
    const tail = 'bbbb'
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: front } }, 2))
    t += PET_REASONING_PUSH_INTERVAL_MS + 1
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: tail } }, 3))
    const last = pushes.at(-1)!
    expect(last.payload.liveActivity).toMatchObject({ kind: 'reasoning' })
    // 只保留窗口尾部：最新内容在末尾，前段被丢弃，长度被窗口约束。
    const text = String((last.payload.liveActivity as { text?: string }).text)
    expect(text.endsWith(tail)).toBe(true)
    expect(text.length).toBe(PET_REASONING_TAIL_WINDOW)
  })

  it('reasoning 文本按 500ms 节流：窗口内多次增量只推送一次，窗口外才推送', () => {
    let t = 0
    const { reducer, pushes } = collect({ now: () => t })
    reducer.create(peer())
    reducer.apply(peer(), ev('turn/start', { turn: 1 }, 1))
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'aaa' } }, 2))
    const afterFirst = pushes.length
    // 窗口内的连续增量：状态累积但不再推送。
    t += 200
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'bbb' } }, 3))
    t += 200
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'ccc' } }, 4))
    expect(pushes.length).toBe(afterFirst)
    // 越过窗口后下一增量才推送一次，且内容包含累计尾部。
    t += 200
    reducer.apply(peer(), ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'ddd' } }, 5))
    expect(pushes.length).toBe(afterFirst + 1)
    const last = pushes.at(-1)!
    const text = String((last.payload.liveActivity as { text?: string }).text)
    expect(text.endsWith('ddd')).toBe(true)
  })

  it('子代理 origin 透传给展示 payload', () => {
    const { reducer, pushes } = collect()
    reducer.apply(peer({ origin: 'subagent' }), ev('turn/start', { turn: 1 }, 1))
    const last = pushes.at(-1)!
    expect(last.payload.origin).toBe('subagent')
  })

  it('filter 只对 foldable 事件转发：todo/write 等 log-only 事件不产生 update', () => {
    const { reducer, pushes } = collect()
    reducer.create(peer())
    const before = pushes.length
    reducer.apply(peer(), ev('todo/write', { todos: [{ id: 't1', content: 'x' }] }, 1))
    expect(pushes.length).toBe(before)
  })
})
