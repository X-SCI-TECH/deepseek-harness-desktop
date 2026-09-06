import type { SessionLiveActivity } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPetSessionForwarder } from './activity'

/**
 * 可变的 mock 状态（vi.mock 工厂被提升到文件顶部，只能引用 vi.hoisted 返回的容器）。
 * petState.status 控制 fetchPetStatus 返回值；storeState.status 控制 getPetUiSnapshot
 * 返回值（活动转发引擎的 enabled 门控来源）。
 */
const h = vi.hoisted(() => {
  const storeState = {
    listeners: [] as Array<() => void>,
    status: null as { enabled: boolean, active_pet: string, visible: boolean } | null,
  }
  const petState = {
    pushed: [] as Array<{ action: string, session: unknown }>,
    status: { enabled: true, active_pet: 'maid', visible: true },
  }
  return { storeState, petState }
})

vi.mock('../store', () => ({
  subscribePetUi: (listener: () => void) => {
    h.storeState.listeners.push(listener)
    return () => {
      const i = h.storeState.listeners.indexOf(listener)
      if (i >= 0)
        h.storeState.listeners.splice(i, 1)
    }
  },
  getPetUiSnapshot: () => ({ status: h.storeState.status }),
  beginPetStatusFetch: () => 1,
  commitPetStatusFetch: () => true,
}))

// dsh-tauri/client 的 dist 在模块顶层引用 window（桌面 iframe 环境中存在），node 测试环境
// 无法加载。这里 mock 掉它，只提供与真实实现语义一致的轻量 createLifecycleController。
vi.mock('dsh-tauri/client', () => {
  function createLifecycleController() {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const intervals = new Set<ReturnType<typeof setInterval>>()
    const disposers: Array<() => void> = []
    let disposed = false
    return {
      add: (disposer: () => void) => {
        if (!disposed)
          disposers.push(disposer)
      },
      timeout: (fn: () => void, ms: number) => {
        if (disposed)
          return () => {}
        const timer = setTimeout(() => {
          timers.delete(timer)
          if (!disposed)
            fn()
        }, ms)
        timers.add(timer)
        return () => {
          timers.delete(timer)
          clearTimeout(timer)
        }
      },
      interval: (fn: () => void, ms: number) => {
        if (disposed)
          return () => {}
        const timer = setInterval(() => {
          if (!disposed)
            fn()
        }, ms)
        intervals.add(timer)
        return () => {
          intervals.delete(timer)
          clearInterval(timer)
        }
      },
      listen: () => () => {},
      observe: () => ({ disconnect: () => {} }),
      isDisposed: () => disposed,
      dispose: () => {
        if (disposed)
          return
        disposed = true
        for (const timer of timers)
          clearTimeout(timer)
        timers.clear()
        for (const timer of intervals)
          clearInterval(timer)
        intervals.clear()
        for (const disposer of disposers)
          disposer()
        disposers.length = 0
      },
    }
  }
  return { createLifecycleController }
})

vi.mock('./pet', () => ({
  pushPetSession: async (action: string, session: unknown) => {
    h.petState.pushed.push({ action, session })
  },
  fetchPetStatus: async () => h.petState.status,
}))

/** 一个可控的假会话：getSnapshot 稳定返回同一引用直到 setSnapshot 换引用 (并触发订阅)。 */
function makeSession(id: string, initial: Record<string, unknown>) {
  let snapshot = initial
  const listeners: Array<() => void> = []
  return {
    sessionId: id,
    session: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.push(listener)
        return () => {
          const i = listeners.indexOf(listener)
          if (i >= 0)
            listeners.splice(i, 1)
        }
      },
    },
    /** 换引用并触发订阅（模拟会话状态真实变化）。 */
    setSnapshot(next: Record<string, unknown>) {
      snapshot = next
      for (const listener of [...listeners])
        listener()
    },
  }
}

interface SessionsHarness {
  list: {
    getSnapshot: () => { byId?: Record<string, Record<string, unknown>>, ids: readonly string[] }
    subscribe: (listener: () => void) => () => void
  }
  binding: (id: string) => unknown
}

function makeSessions(byId: Record<string, Record<string, unknown>>, bindings: Array<ReturnType<typeof makeSession>>): SessionsHarness {
  const ids = Object.keys(byId)
  const bindingBySessionId = new Map(bindings.map(b => [b.sessionId, b]))
  const list = { byId, ids }
  const listListeners: Array<() => void> = []
  return {
    list: {
      getSnapshot: () => list,
      subscribe: (listener: () => void) => {
        listListeners.push(listener)
        return () => {
          const i = listListeners.indexOf(listener)
          if (i >= 0)
            listListeners.splice(i, 1)
        }
      },
    },
    binding: (id: string) => bindingBySessionId.get(id),
  }
}

function register(ctxSessions: SessionsHarness): () => void {
  let cleanup: () => void = () => {}
  const ctx = {
    sessions: ctxSessions,
    effect: (fn: () => () => void) => { cleanup = fn() },
  }
  registerPetSessionForwarder(ctx as never)
  return cleanup
}

const IDLE_SUMMARY = (id: string): Record<string, unknown> => ({ id, title: `会话${id}`, status: 'idle' })

describe('dsh-tauri-pet registerPetSessionForwarder', () => {
  let cleanup: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    h.storeState.listeners = []
    h.storeState.status = { enabled: true, active_pet: 'maid', visible: true }
    h.petState.pushed = []
    h.petState.status = { enabled: true, active_pet: 'maid', visible: true }
  })

  afterEach(() => {
    cleanup?.()
    vi.useRealTimers()
  })

  it('未变化的空闲会话不反复转发（只 create 一次，update 0 次）', () => {
    const a = makeSession('a', { id: 'a', status: 'idle' })
    const b = makeSession('b', { id: 'b', status: 'idle' })
    const sessions = makeSessions({ a: IDLE_SUMMARY('a'), b: IDLE_SUMMARY('b') }, [a, b])
    cleanup = register(sessions)

    // 注册即 reconcile：两个会话各发一次 create
    expect(h.petState.pushed).toHaveLength(2)
    expect(h.petState.pushed.map(p => p.action)).toEqual(['create', 'create'])

    // 推进 3 个 1000ms 的 reconcile 周期，状态未变，不再转发 update
    vi.advanceTimersByTime(1000 * 3)
    expect(h.petState.pushed.filter(p => p.action === 'update')).toHaveLength(0)
    expect(h.petState.pushed).toHaveLength(2)
  })

  it('dirty 标记下 interval 对账仍能捕获新增成员（list/内容变化重新同步）', () => {
    const a = makeSession('a', { id: 'a', status: 'idle' })
    const c = makeSession('c', { id: 'c', status: 'idle' })
    // 初始 list 只有 a；但 binding map 已含 c（模拟上游稍后才把 c 纳入注册表）。
    const sessions = makeSessions({ a: IDLE_SUMMARY('a') }, [a, c])
    cleanup = register(sessions)

    expect(h.petState.pushed.map(p => p.action)).toEqual(['create']) // 初始对账：只 a → create

    // 内容变化（a）置 dirty → 100ms flush 转发 update
    a.setSnapshot({ id: 'a', status: 'running' })
    vi.advanceTimersByTime(100)
    expect(h.petState.pushed).toHaveLength(2)

    // 向注册表新增成员 c（改 list.byId/ids，不触发 a/c 的会话订阅）
    const list = sessions.list.getSnapshot() as unknown as { byId: Record<string, unknown>, ids: string[] }
    list.byId.c = IDLE_SUMMARY('c')
    list.ids = ['a', 'c']
    // interval 对账（此时 dirty=true，来自上面内容变化）→ 捕获 c → 补发 create
    vi.advanceTimersByTime(1000)
    expect(h.petState.pushed.map(p => p.action)).toContain('create')
    expect(h.petState.pushed.map(p => (p.session as { id: string }).id)).toContain('c')
  })

  it('宠物未启用（disabled）时完全不转发', () => {
    h.storeState.status = { enabled: false, active_pet: 'maid', visible: false }
    h.petState.status = { enabled: false, active_pet: 'maid', visible: false }
    const a = makeSession('a', { id: 'a', status: 'idle' })
    const sessions = makeSessions({ a: IDLE_SUMMARY('a') }, [a])
    cleanup = register(sessions)

    expect(h.petState.pushed).toHaveLength(0)
    // 会话变化也只进待发队列，但 enabled=false，flush 同样不转发
    a.setSnapshot({ id: 'a', status: 'running' })
    vi.advanceTimersByTime(1000)
    expect(h.petState.pushed).toHaveLength(0)
  })

  it('禁用 → 启用过渡时对全部当前会话补发 create', () => {
    h.storeState.status = { enabled: false, active_pet: 'maid', visible: false }
    h.petState.status = { enabled: false, active_pet: 'maid', visible: false }
    const a = makeSession('a', { id: 'a', status: 'idle' })
    const b = makeSession('b', { id: 'b', status: 'idle' })
    const sessions = makeSessions({ a: IDLE_SUMMARY('a'), b: IDLE_SUMMARY('b') }, [a, b])
    cleanup = register(sessions)
    expect(h.petState.pushed).toHaveLength(0)

    // 设置页/图标把 enabled 写为 true，store 通知订阅者 → 转发引擎补发 create
    h.storeState.status = { enabled: true, active_pet: 'maid', visible: true }
    for (const listener of [...h.storeState.listeners])
      listener()

    expect(h.petState.pushed.map(p => p.action)).toEqual(['create', 'create'])
    expect(h.petState.pushed.map(p => (p.session as { id: string }).id)).toEqual(['a', 'b'])
  })

  it('会话快照真实变化才转发 update（不变字段不触发）', () => {
    const a = makeSession('a', { id: 'a', status: 'idle' })
    const sessions = makeSessions({ a: IDLE_SUMMARY('a') }, [a])
    cleanup = register(sessions)
    expect(h.petState.pushed).toHaveLength(1)

    // 只改一个被转发的字段：status idle→running → 100ms 合并 flush 后补发一次 update
    a.setSnapshot({ id: 'a', status: 'running' })
    expect(h.petState.pushed).toHaveLength(1) // 合并节流：还没到 flush 时刻
    vi.advanceTimersByTime(100)
    expect(h.petState.pushed).toHaveLength(2)
    expect(h.petState.pushed[1]).toMatchObject({ action: 'update', session: { id: 'a', status: 'running' } })
  })

  it('仅非转发字段变化时不转发（投影去重）', () => {
    const a = makeSession('a', { id: 'a', status: 'idle' })
    const sessions = makeSessions({ a: IDLE_SUMMARY('a') }, [a])
    cleanup = register(sessions)
    expect(h.petState.pushed).toHaveLength(1)

    // summary/快照都没有变，唯一的差异来自事件的 liveActivity 折叠（仍为 null）与一个非转发字段
    a.setSnapshot({ id: 'a', status: 'idle', hugeUnusedField: { recursive: true } })
    expect(h.petState.pushed).toHaveLength(1)
    vi.advanceTimersByTime(100)
    expect(h.petState.pushed).toHaveLength(1)
  })

  it('subagent 会话正常转发，running 翻回 false 时补发 update（不再恒显思考中）', () => {
    // 子代理会话：list.byId 标 origin==='subagent'（侧边栏按此隐藏，但不影响转发）。
    // 其 running 由 session-controller 权威维护（run 结束 → handleRunning(false)，保留在注册表）。
    const a = makeSession('a', { id: 'a', status: 'running', running: true })
    const sessions = makeSessions({ a: { id: 'a', title: '会话a', origin: 'subagent' } }, [a])
    cleanup = register(sessions)

    // 注册即 reconcile：subagent 会话照常转发 create（保留转发，气泡进入「思考中」）
    expect(h.petState.pushed).toHaveLength(1)
    expect(h.petState.pushed[0]).toMatchObject({ action: 'create', session: { id: 'a', running: true } })

    // 运行结束：snapshot.running 翻回 false → 100ms 合并 flush 后补发一次 update，气泡切「已完成」
    a.setSnapshot({ id: 'a', status: 'idle', running: false })
    expect(h.petState.pushed).toHaveLength(1) // 合并节流：还没到 flush 时刻
    vi.advanceTimersByTime(100)
    expect(h.petState.pushed).toHaveLength(2)
    expect(h.petState.pushed[1]).toMatchObject({ action: 'update', session: { id: 'a', running: false } })
  })

  it('事件窗口折叠出 liveActivity 时随 update 转发一次', () => {
    // 构造带 eventSource 的会话：绑定即折叠，无活动 → activity null
    let windowEntries: unknown[] = []
    const listeners: Array<() => void> = []
    const snapshot = { id: 'a', status: 'running' }
    const liveActivity: SessionLiveActivity = { kind: 'tool', name: 'pwsh', args: '{"command":"ls"}' }
    const sessions = makeSessions({ a: IDLE_SUMMARY('a') }, [])
    sessions.binding = (id: string) => id === 'a'
      ? ({
          sessionId: 'a',
          eventSource: {
            getSnapshot: () => ({ entries: windowEntries }),
            subscribe: (l: () => void) => {
              listeners.push(l)
              return () => {}
            },
          },
          session: {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
          },
        })
      : undefined

    cleanup = register(sessions)
    // 绑定即折叠一次并发送 create
    expect(h.petState.pushed).toHaveLength(1)

    // 事件窗口填充工具调用 → 订阅触发 → 300ms trailing 节流后折叠出 liveActivity 并转发
    windowEntries = [{ type: 'event', event: { type: 'tool/call', data: { callId: 'c1', name: 'pwsh', arguments: '{"command":"ls"}' } } }]
    for (const listener of [...listeners])
      listener()
    expect(h.petState.pushed).toHaveLength(1)
    vi.advanceTimersByTime(300)
    expect(h.petState.pushed).toHaveLength(2)
    const last = h.petState.pushed[1]
    expect(last.action).toBe('update')
    expect((last.session as { liveActivity: unknown }).liveActivity).toEqual(liveActivity)
  })
})
