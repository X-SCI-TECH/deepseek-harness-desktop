import type { PetStatus } from './use-pet'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { toast } from '@/utils/toast'

export interface BubbleSession {
  [key: string]: unknown
  id: string
}

export interface BubbleHandle {
  readonly status: PetStatus | undefined
}

type SessionAction = 'create' | 'remove' | 'update'

const FAILED_BUBBLE_TIMEOUT = 4000
const REVIEW_BUBBLE_TIMEOUT = 2500
const SUCCESS_TOAST_TIMEOUT = 3000
const FAILED_PULSE_TTL = 1800
/** 会话完成/变空闲后保留的时长：超过即从会话表沉淀，防止 durable subagent 等永不发 remove 的会话无界积累。 */
const IDLE_SESSION_RETENTION = 5000
/** 子代理标签（按窗口语言就近取单语文案；桌宠窗口无 i18n 基础设施，与 pet.tsx 保留文案一致）。 */
const SUBAGENT_LABEL = (document.documentElement.lang || navigator.language || 'zh-CN').toLowerCase().startsWith('zh')
  ? '子代理'
  : 'Subagent'

/** 状态优先级映射，数值越大优先级越高 */
const STATUS_PRIORITY = {
  'waiting': 4,
  'review': 3,
  'failed': 2,
  'running': 1,
  'idle': 0,
  'turn': 0,
  'moving-left': 0,
  'moving-right': 0,
  'waving': 0,
}

/** 桌宠窗口的会话气泡：DSH 发送原始会话快照，本 hook 私有管理会话→toast key 映射，仅暴露聚合宠物状态。 */
export function useBubble(): BubbleHandle {
  const [status, setStatus] = useState<PetStatus | undefined>(undefined)

  useEffect(() => {
    const sessions = new Map<string, BubbleSession>()
    const toastKeys = new Map<string, string>()
    const hideTimers = new Map<string, number>()
    const previousStatus = new Map<string, PetStatus | undefined>()
    const failedUntil = new Map<string, number>()
    const pulseTimers = new Map<string, number>()
    const consumedFailed = new Set<string>()
    const dismissed = new Set<string>()
    const pruneTimers = new Map<string, number>()
    let lastAgg: PetStatus | undefined
    const updateAgg = () => {
      const next = statusOf(sessions, failedUntil, Date.now())
      if (next !== lastAgg)
        lastAgg = next
      if (!disposed)
        setStatus(next)
    }
    let disposed = false

    const clearTimer = (map: Map<string, number>, id: string) => {
      const timer = map.get(id)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        map.delete(id)
      }
    }

    const closeToast = (id: string) => {
      clearTimer(hideTimers, id)
      const key = toastKeys.get(id)
      if (key !== undefined) {
        toast.close(key)
        toastKeys.delete(id)
      }
    }

    /** 收敛：会话完成/变空闲后超过 IDLE_SESSION_RETENTION 仍保持 undefined 才移除，避免长期会话里 Map 无界增长。 */
    const pruneSession = (id: string) => {
      if (disposed)
        return
      const session = sessions.get(id)
      if (session === undefined || sessionStatus(session) !== undefined)
        return
      sessions.delete(id)
      previousStatus.delete(id)
      dismissed.delete(id)
      failedUntil.delete(id)
      consumedFailed.delete(id)
      clearTimer(pulseTimers, id)
      clearTimer(hideTimers, id)
      closeToast(id)
      updateAgg()
    }

    const armPrune = (id: string) => {
      clearTimer(pruneTimers, id)
      pruneTimers.set(id, window.setTimeout(() => {
        pruneTimers.delete(id)
        pruneSession(id)
      }, IDLE_SESSION_RETENTION))
    }

    const scheduleHide = (id: string, current: PetStatus) => {
      clearTimer(hideTimers, id)
      const timeout = current === 'failed' ? FAILED_BUBBLE_TIMEOUT : current === 'review' ? REVIEW_BUBBLE_TIMEOUT : undefined
      const key = toastKeys.get(id)
      if (timeout === undefined || key === undefined)
        return

      const timer = window.setTimeout(() => {
        if (toastKeys.get(id) === key) {
          dismissed.add(id)
          closeToast(id)
        }
      }, timeout)
      hideTimers.set(id, timer)
    }

    const trackFailedPulse = (session: BubbleSession) => {
      const current = sessionStatus(session)
      const previous = previousStatus.get(session.id)

      if (current === 'failed') {
        if (previous === 'failed' || consumedFailed.has(session.id))
          return

        const deadline = Date.now() + FAILED_PULSE_TTL
        failedUntil.set(session.id, deadline)
        clearTimer(pulseTimers, session.id)

        const timer = window.setTimeout(() => {
          if (disposed || failedUntil.get(session.id) !== deadline)
            return
          failedUntil.delete(session.id)
          clearTimer(pulseTimers, session.id)
          consumedFailed.add(session.id)
          updateAgg()
        }, FAILED_PULSE_TTL)

        pulseTimers.set(session.id, timer)
      }
      else {
        failedUntil.delete(session.id)
        clearTimer(pulseTimers, session.id)
        consumedFailed.delete(session.id)
      }
    }

    const syncToast = (session: BubbleSession) => {
      const current = sessionStatus(session)
      const previous = previousStatus.get(session.id)
      previousStatus.set(session.id, current)
      const key = toastKeys.get(session.id)

      if (current === undefined) {
        const completed = previous === 'running'
        if (key !== undefined)
          closeToast(session.id)
        if (completed) {
          toast(sessionTitle(session).trim(), {
            description: '已完成',
            placement: 'top end',
            variant: 'success',
            timeout: SUCCESS_TOAST_TIMEOUT,
          })
        }
        // 从有状态变为空闲/完成 → 安排沉淀（durable subagent 永不发 remove，靠此收敛）
        if (previous !== undefined)
          armPrune(session.id)
        return
      }

      // 会话恢复活跃（running/failed/review/waiting）→ 取消待执行的沉淀
      clearTimer(pruneTimers, session.id)
      const isTerminal = current === 'failed' || current === 'review'
      if (!isTerminal)
        dismissed.delete(session.id)

      const content = toastContent(session, current)
      if (key === undefined) {
        if (dismissed.has(session.id) || (previous !== undefined && previous === current))
          return

        let createdKey = ''
        createdKey = toast(content.title, {
          isLoading: content.isLoading,
          description: content.description,
          placement: 'top end',
          variant: content.variant,
          timeout: 0,
          onClose: () => {
            if (toastKeys.get(session.id) === createdKey) {
              toastKeys.delete(session.id)
              clearTimer(hideTimers, session.id)
            }
          },
        })
        toastKeys.set(session.id, createdKey)
      }
      else {
        toast.update(key, content)
      }

      if (previous !== current && isTerminal) {
        scheduleHide(session.id, current)
      }
    }

    const apply = (payload: unknown, action: SessionAction) => {
      const session = rawSession(payload)
      if (!session)
        return

      if (action === 'remove') {
        sessions.delete(session.id)
        previousStatus.delete(session.id)
        dismissed.delete(session.id)
        failedUntil.delete(session.id)
        consumedFailed.delete(session.id)
        clearTimer(pulseTimers, session.id)
        clearTimer(hideTimers, session.id)
        clearTimer(pruneTimers, session.id)
        closeToast(session.id)
      }
      else {
        sessions.set(session.id, session)
        trackFailedPulse(session)
        syncToast(session)
      }

      updateAgg()
    }

    let unlisteners: Array<() => void> = []
    void Promise.all([
      listen('session:create', e => apply(e.payload, 'create')),
      listen('session:update', e => apply(e.payload, 'update')),
      listen('session:remove', e => apply(e.payload, 'remove')),
    ]).then((listeners) => {
      if (disposed)
        listeners.forEach(u => u())
      else unlisteners = listeners
    }).catch(() => {})

    return () => {
      disposed = true
      unlisteners.forEach(u => u())
      hideTimers.forEach(t => window.clearTimeout(t))
      hideTimers.clear()
      pulseTimers.forEach(t => window.clearTimeout(t))
      pulseTimers.clear()
      pruneTimers.forEach(t => window.clearTimeout(t))
      pruneTimers.clear()
      toastKeys.forEach(k => toast.close(k))
      toastKeys.clear()
    }
  }, [])

  return { status }
}

/** 统一解析原始会话对象 */
function rawSession(payload: unknown): BubbleSession | undefined {
  if (!payload || typeof payload !== 'object')
    return undefined
  const value = payload as Record<string, unknown>
  const session = (value.session && typeof value.session === 'object' ? value.session : value) as Record<string, unknown>
  const id = session.id ?? session.sessionId
  return typeof id === 'string' && id.length > 0 ? { ...session, id } : undefined
}

/** 会话标题：子代理（origin==='subagent'）加本地化「子代理/Subagent」前缀，便于区分。 */
function sessionTitle(session: BubbleSession): string {
  const base = [session.title, session.displayTitle, session.name, session.id]
    .find(v => typeof v === 'string' && v.trim()) as string || '会话'
  return session.origin === 'subagent' ? `${SUBAGENT_LABEL}：${base}` : base
}

/** 提取单个会话的状态（忽略底层恢复逻辑） */
function sessionStatus(session: BubbleSession, ignoreError = false): PetStatus | undefined {
  const value = session.status ?? session.activity ?? session.phase
  if (!ignoreError && (value === 'failed' || value === 'error' || session.lastAgentError))
    return 'failed'
  if (value === 'review' || value === 'reviewing' || value === 'plan-review')
    return 'review'

  const hasInteraction = session.pendingInteraction !== undefined && session.pendingInteraction !== null && session.pendingInteraction !== false
  const hasPending = Array.isArray(session.pending) ? session.pending.length > 0 : session.pending !== undefined && session.pending !== null
  if (value === 'waiting' || value === 'pending' || value === 'blocked' || hasInteraction || hasPending)
    return 'waiting'

  if (value === 'running' || value === 'working' || value === 'thinking' || session.running === true)
    return 'running'
  return undefined
}

/** 零内存分配计算聚合最高优先级状态 */
function statusOf(
  sessions: ReadonlyMap<string, BubbleSession>,
  failedUntil: ReadonlyMap<string, number>,
  now: number,
): PetStatus | undefined {
  let highestStatus: PetStatus | undefined
  let maxPriority = 0

  for (const session of sessions.values()) {
    let status = sessionStatus(session)
    if (status === 'failed') {
      const deadline = failedUntil.get(session.id)
      if (deadline === undefined || now >= deadline) {
        status = sessionStatus(session, true) // 底层恢复状态
      }
    }

    if (status) {
      const priority = STATUS_PRIORITY[status]
      if (priority > maxPriority) {
        maxPriority = priority
        highestStatus = status
        if (maxPriority === 4)
          break // 已是最高优先级 waiting，可提前结束循环
      }
    }
  }
  return highestStatus
}

/** 生成 Toast 渲染数据（内置工具/思考标签提取） */
function toastContent(session: BubbleSession, status: PetStatus) {
  const getFirstString = (...items: unknown[]) => {
    for (const item of items) {
      if (typeof item === 'string' && item.trim().length > 0)
        return item.trim()
    }
    return undefined
  }

  const getLiveActivity = (): string | undefined => {
    if (status !== 'running' || !session.liveActivity || typeof session.liveActivity !== 'object')
      return undefined
    const { kind, text, name, args } = session.liveActivity as Record<string, unknown>

    if (kind === 'reasoning' && typeof text === 'string' && text.trim()) {
      return `思考 · ${text.replace(/\s+/g, ' ').trim()}`
    }
    if (kind === 'tool' && typeof name === 'string' && name) {
      let detail: string | undefined
      if (typeof args === 'string' && args) {
        try {
          const parsed = JSON.parse(args)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const keys = name === 'pwsh' || name === 'bash' ? ['command'] : name === 'str_replace_editor' ? ['path'] : ['file_path', 'path']
            for (const k of keys) {
              if (typeof parsed[k] === 'string' && parsed[k].trim()) {
                detail = parsed[k].replace(/\s+/g, ' ').trim()
                break
              }
            }
          }
        }
        catch {}
      }
      if (name === 'pwsh' || name === 'bash')
        return `${name === 'pwsh' ? 'Pwsh' : 'Bash'} · ${detail ?? '命令执行'}`
      if (name === 'str_replace_editor' || name === 'edit' || name === 'write')
        return `编辑 · ${detail ?? name}`
      return `工具调用 · ${name}`
    }
    return undefined
  }

  const isSub = session.origin === 'subagent'
  const title = sessionTitle(session)
  const statusText = status === 'failed' ? '失败' : status === 'review' ? '待审阅' : status === 'waiting' ? '等待中' : status === 'running' ? (isSub ? '运行中' : '思考中') : '空闲'
  const description = getFirstString(
    session.description,
    session.message,
    session.lastAgentError ? `失败：${String(session.lastAgentError)}` : undefined,
    getLiveActivity(),
    statusText,
  ) ?? '会话'

  return {
    title,
    description,
    isLoading: status === 'running',
    variant: (status === 'failed' ? 'danger' : 'default') as 'danger' | 'default',
  }
}
