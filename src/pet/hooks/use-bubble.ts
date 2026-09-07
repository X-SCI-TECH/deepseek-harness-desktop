import type { ToastContentValue } from '@heroui/react'
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

/** 桌宠窗口无 i18n 基础设施，就地按窗口语言取单语文案（与 pet.tsx 保留文案一致）。 */
const IS_ZH = (typeof document !== 'undefined' ? document.documentElement.lang || navigator.language : 'zh-CN')
  .toLowerCase()
  .startsWith('zh')

/** 常用文案常量 */
const LABELS = {
  subagent: IS_ZH ? '子代理' : 'Subagent',
  waitApproval: IS_ZH ? '需授权' : 'Needs approval',
  waitChoice: IS_ZH ? '需选择' : 'Needs your input',
} as const

/** 工具名 → toast 展示标签（沿用既有风格：英文工具名大写 / 中文动词）。 */
const TOOL_LABELS: Record<string, string> = {
  pwsh: 'Pwsh',
  bash: 'Bash',
  grep: 'Grep',
  glob: 'Glob',
  read: '读取',
  read_image: '看图',
  write: '写入',
  edit: '编辑',
  str_replace_editor: '编辑',
  web_search: '搜索',
  web_fetch: '抓取',
  think: '思考',
  skill: '技能',
} as const

/** 工具名 → 从 args（JSON 字符串）提取展示明细的键，按优先级取第一个非空值。 */
const TOOL_ARG_KEYS: Record<string, readonly string[]> = {
  pwsh: ['command'],
  bash: ['command'],
  grep: ['pattern'],
  glob: ['pattern'],
  read: ['file_path', 'path'],
  read_image: ['file_path', 'path'],
  write: ['file_path', 'path'],
  edit: ['file_path', 'path'],
  str_replace_editor: ['file_path', 'path'],
  web_search: ['queries', 'query'],
  web_fetch: ['url'],
  think: ['thought'],
  skill: ['name'],
} as const

/** 状态优先级映射，数值越大优先级越高 */
const STATUS_PRIORITY: Record<string, number> = {
  'waiting': 4,
  'review': 3,
  'failed': 2,
  'running': 1,
  'idle': 0,
  'turn': 0,
  'moving-left': 0,
  'moving-right': 0,
  'waving': 0,
} as const

/** 桌宠窗口的会话气泡：DSH 发送原始会话快照，本 hook 私有管理会话→toast key 映射，仅暴露聚合宠物状态。 */
export function useBubble(): BubbleHandle {
  const [status, setStatus] = useState<PetStatus | undefined>(undefined)

  useEffect(() => {
    // 状态容器定义
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
    let disposed = false

    const updateAgg = () => {
      const next = statusOf(sessions, failedUntil, Date.now())
      if (next !== lastAgg) {
        lastAgg = next
        if (!disposed) {
          setStatus(next)
        }
      }
    }

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

    /** 清除指定会话的所有关联缓存及定时器 */
    const removeSessionData = (id: string) => {
      sessions.delete(id)
      previousStatus.delete(id)
      dismissed.delete(id)
      failedUntil.delete(id)
      consumedFailed.delete(id)
      clearTimer(pulseTimers, id)
      clearTimer(hideTimers, id)
      clearTimer(pruneTimers, id)
      closeToast(id)
    }

    /** 沉淀清除：超过保留时间后彻底清理空闲会话 */
    const pruneSession = (id: string) => {
      if (disposed)
        return
      const session = sessions.get(id)
      if (!session || sessionStatus(session) !== undefined)
        return

      removeSessionData(id)
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
        if (key !== undefined)
          closeToast(session.id)

        // 子代理静默关闭：不弹「已完成」成功 toast
        if (previous === 'running' && session.origin !== 'subagent') {
          toast(sessionTitle(session).trim(), {
            description: '已完成',
            placement: 'top end',
            variant: 'success',
            timeout: SUCCESS_TOAST_TIMEOUT,
          })
        }
        if (previous !== undefined)
          armPrune(session.id)
        return
      }

      clearTimer(pruneTimers, session.id)
      const isTerminal = current === 'failed' || current === 'review'
      if (!isTerminal) {
        dismissed.delete(session.id)
      }

      const content = toastContent(session, current)
      if (key === undefined) {
        if (dismissed.has(session.id) || previous === current)
          return

        let createdKey = ''
        createdKey = toast(content.title, {
          isLoading: content.isLoading,
          description: content.description,
          placement: 'top end',
          variant: content.variant as 'warning' | 'danger' | 'default',
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
        toast.update(key, content as ToastContentValue)
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
        removeSessionData(session.id)
      }
      else {
        sessions.set(session.id, session)
        trackFailedPulse(session)
        syncToast(session)
      }

      updateAgg()
    }

    let unlisteners: Array<() => void> = []
    Promise.all([
      listen('session:create', e => apply(e.payload, 'create')),
      listen('session:update', e => apply(e.payload, 'update')),
      listen('session:remove', e => apply(e.payload, 'remove')),
    ])
      .then((listeners) => {
        if (disposed) {
          listeners.forEach(u => u())
        }
        else {
          unlisteners = listeners
        }
      })
      .catch(() => { })

    return () => {
      disposed = true
      unlisteners.forEach(u => u())

      // 统一清理所有 Map 定时器与 Toast
      const clearAllTimers = (map: Map<string, number>) => {
        map.forEach(t => window.clearTimeout(t))
        map.clear()
      }
      clearAllTimers(hideTimers)
      clearAllTimers(pulseTimers)
      clearAllTimers(pruneTimers)

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

/** 会话标题处理 */
function sessionTitle(session: BubbleSession): string {
  const base = [session.title, session.displayTitle, session.name, session.id]
    .find((v): v is string => typeof v === 'string' && Boolean(v.trim())) || '会话'

  if (session.phase === 'approval')
    return `${LABELS.waitApproval} · ${base}`
  if (session.phase === 'user-question' || session.phase === 'blocked')
    return `${LABELS.waitChoice} · ${base}`
  if (session.origin === 'subagent')
    return `${LABELS.subagent}：${base}`
  return base
}

/** 提取单个会话的状态（忽略底层恢复逻辑） */
function sessionStatus(session: BubbleSession, ignoreError = false): PetStatus | undefined {
  const value = session.status ?? session.activity ?? session.phase

  if (!ignoreError && (value === 'failed' || value === 'error' || Boolean(session.lastAgentError))) {
    return 'failed'
  }
  if (value === 'review' || value === 'reviewing' || value === 'plan-review') {
    return 'review'
  }

  const hasInteraction = Boolean(session.pendingInteraction)
  const hasPending = Array.isArray(session.pending) ? session.pending.length > 0 : Boolean(session.pending)

  if (value === 'waiting' || value === 'pending' || value === 'blocked' || hasInteraction || hasPending) {
    return 'waiting'
  }

  if (value === 'running' || value === 'working' || value === 'thinking' || session.running === true) {
    return 'running'
  }

  return undefined
}

/** 计算聚合最高优先级状态（零额外堆内存分配） */
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
      const priority = STATUS_PRIORITY[status] ?? 0
      if (priority > maxPriority) {
        maxPriority = priority
        highestStatus = status
        if (maxPriority === 4)
          break // 'waiting' 为最高优先级，提前终止遍历
      }
    }
  }
  return highestStatus
}

/** 格式化空白字符 */
function sanitizeText(str: string): string {
  return str.replace(/\s+/g, ' ').trim()
}

/** 从工具 args（JSON 字符串）按优先级提取展示明细；解析失败或无匹配键时返回 undefined。 */
function toolArgDetail(tool: string, args: unknown): string | undefined {
  if (typeof args !== 'string' || !args)
    return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  }
  catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return undefined

  const record = parsed as Record<string, unknown>
  for (const key of TOOL_ARG_KEYS[tool] ?? ['file_path', 'path']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return sanitizeText(value)
    }
    if (Array.isArray(value)) {
      const first = value.find(item => typeof item === 'string' && item.trim())
      if (typeof first === 'string' && first.trim()) {
        return sanitizeText(first)
      }
    }
  }
  return undefined
}

/** 生成 Toast 渲染数据 */
function toastContent(session: BubbleSession, status: PetStatus) {
  const getFirstString = (...items: unknown[]): string | undefined => {
    for (const item of items) {
      if (typeof item === 'string' && item.trim().length > 0) {
        return item.trim()
      }
    }
    return undefined
  }

  const getLiveActivity = (): string | undefined => {
    if (status !== 'running' || !session.liveActivity || typeof session.liveActivity !== 'object') {
      return undefined
    }

    const { kind, text, name, args } = session.liveActivity as Record<string, unknown>

    if (kind === 'reasoning' && typeof text === 'string' && text.trim()) {
      return `思考 · ${sanitizeText(text)}`
    }

    if (kind === 'tool' && typeof name === 'string' && name) {
      const tool = name.toLowerCase()
      const label = TOOL_LABELS[tool]
      if (!label)
        return `工具调用 · ${name}`

      const detail = toolArgDetail(tool, args)
      return detail ? `${label} · ${detail}` : label
    }

    return undefined
  }

  const isSub = session.origin === 'subagent'
  const title = sessionTitle(session)
  const statusTextMap: Record<PetStatus, string> = {
    'failed': '失败',
    'review': '待审阅',
    'waiting': '等待中',
    'running': isSub ? '运行中' : '思考中',
    'idle': '空闲',
    'turn': '空闲',
    'moving-left': '空闲',
    'moving-right': '空闲',
    'waving': '空闲',
  }

  const statusText = statusTextMap[status] ?? '空闲'
  const description = getFirstString(
    session.description,
    session.message,
    session.lastAgentError ? `失败：${String(session.lastAgentError)}` : undefined,
    getLiveActivity(),
    statusText,
  ) ?? '会话'

  const variant = (status === 'waiting' || status === 'review')
    ? 'warning'
    : status === 'failed'
      ? 'danger'
      : 'default'

  return {
    title,
    description,
    isLoading: status === 'running',
    variant,
  }
}
