import type { ClientContext } from 'dsh-tauri/client'
import type { PetStatus, SessionLiveActivity } from '../types'
import { createLifecycleController } from 'dsh-tauri/client'
import { PET_ACTIVITY_THROTTLE_MS, PET_SESSION_SYNC_COALESCE_MS, PET_SESSION_SYNC_INTERVAL_MS, PET_SESSION_UPDATE_THROTTLE_MS } from '../constants'
import { beginPetStatusFetch, commitPetStatusFetch, getPetUiSnapshot, subscribePetUi } from '../store'
import { foldSessionActivity } from '../utils/activity'
import { deepEqual, projectPetPayload } from '../utils/projection'
import { toTransferable } from '../utils/transferable'
import { fetchPetStatus, pushPetSession } from './pet'

type SessionAction = 'create' | 'update' | 'remove'

/**
 * 白名单字段级无变化检测：判断两个投影结果的值引用是否逐一相等（浅比较，按引用）。
 * projectPetPayload 是浅拷贝，字段值引用直接来自会话源对象；DSH 会话 store 为不可变更新，
 * 值对象不原地变更，因此「值引用一致 ⇒ 载荷必不变」。非白名单字段 churn 不会被计入变化。
 */
function sameRefs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length)
    return false
  for (const key of aKeys) {
    if (a[key] !== b[key])
      return false
  }
  return true
}

/**
 * rc.2+ 会话 binding 附带的事件窗口（MutableSessionEventSource，service.js 组装
 * binding 时挂在 eventSource 字段）；alpha 运行时缺失，必须探测使用。
 */
interface RawSessionEventSource {
  getSnapshot: () => { entries: readonly unknown[] }
  subscribe: (listener: () => void) => () => void
}

interface RawSessionBinding {
  sessionId: string
  eventSource?: RawSessionEventSource
  session: {
    getSnapshot: () => unknown
    subscribe: (listener: () => void) => () => void
    open?: () => Promise<unknown>
  }
}

interface RawSessions {
  list: {
    getSnapshot: () => {
      byId?: Record<string, Record<string, unknown>>
      ids: readonly string[]
    }
    subscribe: (listener: () => void) => () => void
  }
  binding: (id: string) => RawSessionBinding | undefined
}

/** 每个已绑定会话的观察状态：订阅清理 + 折叠出的实时活动 + 节流定时器 + 变化检测缓存。 */
interface SessionWatch {
  disposers: Array<() => void>
  /** 事件窗口折叠结果；undefined 表示该会话无事件窗口（alpha），null 表示当前无活动 */
  activity?: SessionLiveActivity | null
  activityTimer?: ReturnType<typeof setTimeout>
  /** 上次已推送的投影载荷（用于深比较去重，避免无变化空转发）。 */
  lastPayload?: Record<string, unknown>
  /**
   * 上次白名单投影值引用（浅拷贝，值引用来自会话源对象）。用于「只对白名单字段做无变化检测」：
   *  non-白名单字段 churn 造出新的 summary/snapshot 对象时，值引用仍一致 ⇒ 载荷必不变，免深克隆。
   */
  lastProjected?: Record<string, unknown>
  /** 上次计算载荷时的输入引用（summary / snapshot / activity）。引用不变 ⇒ 载荷必不变。 */
  lastInput?: {
    summary?: Record<string, unknown>
    snapshot: unknown
    activity?: SessionLiveActivity | null
  }
}

/**
 * 把 DSH 会话原始快照投影后按建议推送给桌宠窗口，不做宠物专用 projection，但做四件事收敛：
 *  - 门控：仅宠物启用（PetStatus.enabled）时才转发，窗口隐藏与否不改变转发；
 *  - 变化检测：summary/snapshot/activity 引用不变则跳过；投影经白名单 + 深比较后才推送；
 *  - 成员幂等对账：list 订阅合并到一次、只在成员真的变化时才全量 sync()；定时 interval 仅 dirty 时对账，
 *    空闲时不再反复重投影（高频转发未变化会话正是 #396 前端延迟的根因）；
 *  - 合并背压：会话订阅事件进共享节流队列，一次突发只批量 flush 一帧。
 * rc.2+ 会话额外订阅事件窗口（binding.eventSource）：流式 delta 逐 token 触发，按会话做
 * trailing 节流，到期时按当前窗口重算实时活动（进行中的工具调用 / 思考流）并以
 * liveActivity 字段并入快照；alpha 缺失事件窗口时退级为纯快照转发。
 */
export function registerPetSessionForwarder(ctx: ClientContext): void {
  ctx.effect(() => {
    const controller = createLifecycleController()
    const watches = new Map<string, SessionWatch>()
    const known = new Set<string>()
    // 门控：只读共享 store 里的 enabled（store 未初始化时保守关闭，转发停止而不是误发）。
    let enabled = getPetUiSnapshot().status?.enabled ?? false
    const pendingUpdates = new Set<string>()
    let flushCancel: (() => void) | undefined
    let syncCancel: (() => void) | undefined
    let disposed = false
    // #396 性能：dirty 标记用于门控「定时全量对账」。内容变化（emit/成员变化/门控切换）标记为 true，
    // 对账结束复位为 false。这样 1s interval 只在真正有变化时才做全量 reconcile，空闲时不再反复重投影。
    let dirty = true

    function emit(action: SessionAction, session: Record<string, unknown>): void {
      if (disposed)
        return
      dirty = true
      const payload = toTransferable(session) as Record<string, unknown>
      void pushPetSession(action, payload).catch((error) => {
        if (!disposed)
          console.error(`[dsh-tauri-pet] session ${action} push failed:`, error)
      })
    }

    const sessions = ctx.sessions as unknown as RawSessions

    /** 合并 list summary 与 binding 快照，并按需附带 liveActivity。 */
    function mergeSnapshot(
      binding: RawSessionBinding,
      summary: Record<string, unknown> | undefined,
      snapshot: unknown,
      activity: SessionLiveActivity | null | undefined,
    ): Record<string, unknown> {
      const value = snapshot && typeof snapshot === 'object'
        ? snapshot as Record<string, unknown>
        : { value: snapshot }
      const merged: Record<string, unknown> = { id: binding.sessionId, ...(summary ?? {}), ...value }
      // 仅在探测到事件窗口的会话上附带 liveActivity；null 也是有效值（清除过期活动展示）
      if (activity !== undefined)
        merged.liveActivity = activity
      return merged
    }

    /**
     * 变化检测转发：输入引用不变 ⇒ 载荷必不变，直接跳过（免 toTransferable/深比较）；
     * 引用变了 ⇒ 投影到白名单并深比较，投影结果一致（如仅非白名单字段变化）则只更新签名
     * 不转发，真正变化才 pushPetSession。
     */
    function emitIfChanged(id: string, binding: RawSessionBinding, action: SessionAction): void {
      if (disposed || !enabled)
        return
      const watch = watches.get(id)
      if (watch === undefined)
        return
      const list = sessions.list.getSnapshot()
      const summary = list.byId?.[id]
      const snapshot = binding.session.getSnapshot()
      const activity = watch.activity
      // 输入引用未变（summary/snapshot/activity 仍是同一对象）⇒ 载荷必不变，直接跳过。
      if (watch.lastInput !== undefined
        && watch.lastInput.summary === summary
        && watch.lastInput.snapshot === snapshot
        && watch.lastInput.activity === activity) {
        return
      }
      const merged = mergeSnapshot(binding, summary, snapshot, activity)
      const projected = projectPetPayload(merged)
      // 白名单字段级无变化检测：值引用逐一一致 ⇒ 载荷必不变，免 toTransferable 深克隆与深比较
      // （非白名单字段 churn 会造出新的 summary/snapshot 对象，但白名单值引用仍稳定）。
      if (watch.lastProjected !== undefined && sameRefs(projected, watch.lastProjected)) {
        watch.lastInput = { summary, snapshot, activity }
        return
      }
      const payload = toTransferable(projected) as Record<string, unknown>
      if (watch.lastPayload !== undefined && deepEqual(payload, watch.lastPayload)) {
        // 引用变但投影结果经白名单+深比较后一致 → 也不转发（仅更新签名）。
        watch.lastInput = { summary, snapshot, activity }
        watch.lastProjected = projected
        return
      }
      watch.lastPayload = payload
      watch.lastProjected = projected
      watch.lastInput = { summary, snapshot, activity }
      emit(action, payload)
    }

    /** 订阅事件窗口：这里只做 trailing 节流，到期时按当前窗口整体重算一次，一次突发只推送一帧。 */
    function attachEventSource(id: string, binding: RawSessionBinding, watch: SessionWatch): void {
      const source = binding.eventSource
      if (source === undefined || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function')
        return
      // 绑定即折叠一次，create 帧就携带已运行会话的实时活动
      const initial = source.getSnapshot()
      watch.activity = foldSessionActivity(initial.entries)
      watch.disposers.push(source.subscribe(() => {
        if (disposed || watches.get(id) !== watch || watch.activityTimer !== undefined)
          return
        watch.activityTimer = globalThis.setTimeout(() => {
          watch.activityTimer = undefined
          const current = source.getSnapshot()
          watch.activity = foldSessionActivity(current.entries)
          // 流式 delta 事件在此 trailing 节流合并为一次折叠，而非逐 token 转发。
          emitIfChanged(id, binding, 'update')
        }, PET_ACTIVITY_THROTTLE_MS)
      }))
      // dsh 只在会话被选中（open）时才建立事件流；子代理等未选中会话的
      // 窗口保持空窗，折叠恒为 null。主动打开会话流（幂等，UI 已开的会话
      // 直接返回），让任何选中状态下的事件都能进入窗口并触发上面的订阅。
      if (typeof binding.session.open === 'function') {
        void binding.session.open().catch((error: unknown) => {
          if (!disposed)
            console.warn(`[dsh-tauri-pet] open event stream for ${id} failed:`, error)
        })
      }
      watch.disposers.push(() => {
        if (watch.activityTimer !== undefined) {
          globalThis.clearTimeout(watch.activityTimer)
          watch.activityTimer = undefined
        }
      })
    }

    function bind(id: string, action: SessionAction): void {
      const binding = sessions.binding(id)
      if (binding === undefined) {
        emit(action, { id })
        return
      }
      const watch: SessionWatch = { disposers: [] }
      watches.set(id, watch)
      attachEventSource(id, binding, watch)
      emitIfChanged(id, binding, action)
      watch.disposers.push(binding.session.subscribe(() => scheduleUpdate(id)))
    }

    function unbind(id: string): void {
      const watch = watches.get(id)
      if (watch === undefined)
        return
      for (const dispose of watch.disposers)
        dispose()
      watches.delete(id)
    }

    /** 会话订阅事件合并：进 pending 队列，由共享节流定时器一次批量 flush。 */
    function scheduleUpdate(id: string): void {
      if (disposed || !enabled)
        return
      pendingUpdates.add(id)
      if (flushCancel !== undefined)
        return
      flushCancel = controller.timeout(() => {
        flushCancel = undefined
        // 一次突发里多个会话的更新只触发一次批量 flush（合并背压）。
        for (const pendingId of pendingUpdates) {
          const binding = sessions.binding(pendingId)
          const watch = watches.get(pendingId)
          if (binding !== undefined && watch !== undefined)
            emitIfChanged(pendingId, binding, 'update')
          pendingUpdates.delete(pendingId)
        }
      }, PET_SESSION_UPDATE_THROTTLE_MS)
    }

    function applyEnabled(next: boolean): void {
      if (next === enabled)
        return
      enabled = next
      pendingUpdates.clear()
      dirty = true
      if (enabled) {
        // 重新启用：对当前全部会话补发 create，桌宠窗口重建状态
        sync()
      }
      else {
        // 关闭宠物：对每个已知会话（含无 binding 仅发过 {id} 的）补发 remove，清空桌宠窗口展示，再释放观察者
        for (const id of [...known]) {
          if (watches.has(id))
            unbind(id)
          emit('remove', { id })
        }
        known.clear()
      }
    }

    function sync(): void {
      // 宠物未启用时不重建观察者、不转发任何会话状态（避免高频空转发）
      if (disposed || !enabled)
        return
      // #396 性能：无任何变化（无 push/无成员变化/无门控切换）时跳过全量对账，interval 只在 dirty 时跑。
      if (!dirty)
        return
      const list = sessions.list.getSnapshot()
      const ids = new Set(list.ids)
      for (const id of known) {
        if (!ids.has(id)) {
          unbind(id)
          emit('remove', { id })
        }
      }
      // 会话注册表对账：转发所有识别到的会话（含 subagent）。
      // subagent 的 `running` 由 session-controller 权威维护：run 结束/移除时经
      // handleSessionStatus / handleSessionRemoved 置为 false（并作为 durable book-keeping
      // 保持在注册表，origin==='subagent' 仅用于侧边栏隐藏，不改变转发）。本引擎原样转发该
      // running 翻转，桌宠气泡据此从「思考中」切到「已完成」，而不是恒显「思考中」。
      for (const id of ids) {
        const binding = sessions.binding(id)
        if (binding === undefined) {
          if (!known.has(id))
            bind(id, 'create')
          continue
        }
        if (watches.has(id)) {
          const watch = watches.get(id)
          // activity 保持 undefined 说明事件窗口此前不可用；运行中补挂一次（成功 attach 后值为 null，不会重复订阅）
          if (watch !== undefined && watch.activity === undefined && binding.eventSource !== undefined)
            attachEventSource(id, binding, watch)
          emitIfChanged(id, binding, 'update')
        }
        else {
          bind(id, known.has(id) ? 'update' : 'create')
        }
      }
      known.clear()
      for (const id of ids)
        known.add(id)
      dirty = false
    }

    // 会话注册表 list 订阅的合并节流：agentic 活动下 list 高频 emit（每 tick 重建 byId），
    // 若每次都直接 sync()，会把全部会话反复做「无变化」重投影（skipProj 爆炸）。合帧到一次。
    // #396 性能：成员未变（无新增/移除）时 list 重建只是再造同一批会话的 byId（内容变化已由
    // 各会话订阅 → scheduleUpdate → flush 处理），无需全量对账——这里只在成员真正变化时才 sync()，
    // 定时 interval 仍做兜底。这砍掉了 idle 时反复全量重投影的空转。
    function scheduleSync(): void {
      if (disposed || !enabled)
        return
      if (syncCancel !== undefined)
        return
      syncCancel = controller.timeout(() => {
        syncCancel = undefined
        const current = sessions.list.getSnapshot().ids
        // 成员集合与上次对账后完全一致 ⇒ 无新增/移除 ⇒ 跳过全量 sync（内容变化走 flush，定时兜底）。
        if (known.size === current.length && current.every(id => known.has(id)))
          return
        dirty = true
        sync()
      }, PET_SESSION_SYNC_COALESCE_MS)
    }

    // 门控来源：订阅共享 store 的 enabled 变化（侧栏图标 / 设置页写入）
    controller.add(subscribePetUi(() => {
      applyEnabled(getPetUiSnapshot().status?.enabled ?? false)
    }))
    // 门控兜底：共享 store 可能尚未被任何消费方初始化，主动拉取一次并入 store
    const revision = beginPetStatusFetch()
    void fetchPetStatus().then((status: PetStatus) => {
      if (disposed)
        return
      commitPetStatusFetch(revision, status)
      applyEnabled(status.enabled)
    }).catch((error: unknown) => {
      if (!disposed)
        console.warn('[dsh-tauri-pet] fetch pet status failed:', error)
    })

    controller.add(sessions.list.subscribe(scheduleSync))
    controller.interval(sync, PET_SESSION_SYNC_INTERVAL_MS)
    controller.add(() => {
      disposed = true
      pendingUpdates.clear()
      if (syncCancel !== undefined) {
        syncCancel()
        syncCancel = undefined
      }
      for (const id of [...watches.keys()])
        unbind(id)
      known.clear()
    })
    sync()
    return () => controller.dispose()
  }, 'dsh-tauri-pet: raw session events')
}
