/**
 * utils/projection.ts — 桌宠转发 payload 的字段投影与变化检测。
 *
 * issue #396 根因之一是转发未经收敛的完整会话快照：字段数量大、嵌套深，且
 * 高频（250ms) 重复转发未变化的会话。这里引入白名单投影 + 深比较，让转发
 * 只携带桌宠窗口实际消费的字段，并且只在投影结果真正变化时才发出 update。
 */

/**
 * 桌宠窗口（src/pet/hooks/use-bubble.ts）实际消费的会话字段白名单。
 * 只在快照存在该字段时投影，缺省字段不补默认值，避免制造不存在的状态。
 */
export const PET_FORWARDED_FIELDS = [
  'id',
  'sessionId',
  'origin',
  'title',
  'displayTitle',
  'name',
  'description',
  'message',
  'status',
  'activity',
  'phase',
  'running',
  'pendingInteraction',
  'pending',
  'lastAgentError',
] as const

/** 桌宠窗口额外消费的实时活动字段（独立处理，仅探测到事件窗口时存在）。 */
export const PET_FORWARDED_ACTIVITY_FIELD = 'liveActivity'

/**
 * 将合并后的会话快照投影为桌宠窗口需要的白名单载荷。
 * 投影是纯函数：输入任何 Record，输出仅含白名单字段的浅拷贝。
 */
export function projectPetPayload(merged: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PET_FORWARDED_FIELDS) {
    if (key in merged)
      out[key] = merged[key]
  }
  if (PET_FORWARDED_ACTIVITY_FIELD in merged)
    out[PET_FORWARDED_ACTIVITY_FIELD] = merged[PET_FORWARDED_ACTIVITY_FIELD]
  return out
}

/**
 * 递归深比较两个 JSON 兼容值（projectPetPayload 投影结果经 toTransferable 后的
 * payload 均为纯数据：无 function/undefined/循环引用）。用于判定投影结果是否
 * 真正变化，以此跳过「字段变了但投影没变」的无意义 update。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b)
    return true
  if (typeof a !== typeof b)
    return false
  if (a === null || b === null || typeof a !== 'object')
    return false
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  if (Array.isArray(aObj) !== Array.isArray(bObj))
    return false
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length)
    return false
  for (const key of aKeys) {
    if (!(key in bObj))
      return false
    if (!deepEqual(aObj[key], bObj[key]))
      return false
  }
  return true
}
