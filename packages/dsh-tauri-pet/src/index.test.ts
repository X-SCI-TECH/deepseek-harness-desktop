import type { HostContext } from 'dsh-tauri'
/**
 * src/index.test.ts — 宿主装配 apply() 的热路径回归。
 *
 * 背景（0.11.x 用户反馈「吐字变慢」）：宿主在**每个** session/event（含逐 token 的
 * assistant/chunk）上都调用 `sessionTitle.get(session)`，而该方法内部是
 * `foldSessionTitle(session.snapshotEvents())` —— 整份会话事件日志 O(N) 复制 + O(N)
 * 扫描，成熟会话单次 1–4 ms。它跑在 append() 的同步发布路径上（与流式转发同进程），
 * 因此会拖慢逐 token 的吐字。本测试锁死「标题折叠次数与会话事件数无关」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, SESSION_STREAM_PATH } from './index'

interface FakeHost {
  ctx: HostContext
  states: Map<string, (...args: unknown[]) => void>
  routes: string[]
  frames: string[]
  titleLookups: () => number
  emitEvent: (session: unknown, event: unknown) => void
  emitDisposed: (session: unknown) => void
  connect: () => void
}

/** 最小宿主上下文替身：记录 sessionTitle 折叠次数、路由与 SSE 帧。 */
function createHost(): FakeHost {
  const states = new Map<string, (...args: unknown[]) => void>()
  const routes: string[] = []
  const frames: string[] = []
  let lookups = 0
  let routeHandler: ((request: unknown, response: unknown) => void) | undefined

  const ctx = {
    get: (name: string) => {
      if (name !== 'sessionTitle')
        return undefined
      return {
        get: () => {
          lookups += 1
          return { title: `title-${lookups}` }
        },
      }
    },
    on: (name: string, handler: (...args: unknown[]) => void) => {
      states.set(name, handler)
    },
    effect: (fn: () => unknown) => {
      fn()
    },
    webServer: {
      register: (route: { path: string, handler: (request: unknown, response: unknown) => void }) => {
        routes.push(route.path)
        routeHandler = route.handler
        return () => {}
      },
    },
  } as unknown as HostContext

  return {
    ctx,
    states,
    routes,
    frames,
    titleLookups: () => lookups,
    emitEvent: (session, event) => {
      states.get('session/event')?.(session, event)
    },
    emitDisposed: (session) => {
      states.get('session/disposed')?.(session)
    },
    connect: () => {
      routeHandler?.({ on: () => {} }, {
        writeHead: () => {},
        write: (chunk: string) => {
          frames.push(chunk)
        },
        end: () => {},
      })
    },
  }
}

/** 取出 SSE 数据帧里的半结构化载荷。 */
function payloads(frames: readonly string[]): Array<{ action: string, payload: Record<string, unknown> }> {
  return frames
    .filter(frame => frame.startsWith('data: '))
    .map(frame => JSON.parse(frame.slice('data: '.length).trim()) as { action: string, payload: Record<string, unknown> })
}

/** 一段流式正文事件（逐 token 的 assistant/chunk）。 */
function chunk(seq: number) {
  return { type: 'assistant/chunk', seq, time: seq, data: { chunk: { type: 'text-delta', text: 'x' } } }
}

describe('pet host apply()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('注册会话流路由', () => {
    const host = createHost()
    apply(host.ctx)
    expect(host.routes).toEqual([SESSION_STREAM_PATH])
  })

  it('标题折叠只在会话首次出现时各读一次，不随流式事件数增长', () => {
    const host = createHost()
    apply(host.ctx)
    const session = { id: 's1' }

    for (let seq = 0; seq < 500; seq++)
      host.emitEvent(session, chunk(seq))
    expect(host.titleLookups()).toBe(1)

    // 另一个会话首次出现：再读一次；同会话后续事件不再触发。
    const other = { id: 's2' }
    host.emitEvent(other, { type: 'turn/start', seq: 0, time: 0, data: {} })
    for (let seq = 1; seq < 200; seq++)
      host.emitEvent(other, chunk(seq))
    expect(host.titleLookups()).toBe(2)
  })

  it('会话销毁后再次出现会重新读一次标题（缓存随会话失效）', () => {
    const host = createHost()
    apply(host.ctx)
    const session = { id: 's1' }

    host.emitEvent(session, chunk(0))
    host.emitDisposed(session)
    host.emitEvent(session, chunk(1))
    expect(host.titleLookups()).toBe(2)
  })

  it('后续标题变化仍由 session/title 事件增量转发到 SSE', () => {
    const host = createHost()
    apply(host.ctx)
    host.connect()
    const session = { id: 's1' }

    host.emitEvent(session, { type: 'turn/start', seq: 0, time: 0, data: {} })
    host.emitEvent(session, { type: 'session/title', seq: 1, time: 1, data: { title: '新标题' } })

    const last = payloads(host.frames).at(-1)
    expect(last?.action).toBe('update')
    expect(last?.payload).toMatchObject({ id: 's1', title: '新标题', displayTitle: '新标题' })
    expect(host.titleLookups()).toBe(1)
  })
})
