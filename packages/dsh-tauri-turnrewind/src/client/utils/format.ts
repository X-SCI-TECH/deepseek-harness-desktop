/**
 * client/utils/format.ts — 纯函数：计数文本、文件名、卡片状态判定、文件清单裁剪。
 *
 * 全部为纯函数，便于单测直接锁定（AGENTS.plugins.md「优先测试纯函数」）。
 * 计数文本供 `ChangeCounts` 的 `title` 使用：视觉是分开着色的两个 span，
 * 但读屏/悬浮提示要拿到同一条「+N -M」文本。
 */

import type { SessionSummary, TurnCardState, TurnFileChange, TurnSummary } from '../types'
import { TURNREWIND_REASON_GIT_REQUIRED } from '../../shared/constants'

/** 单行 `+N -M` 文本；二进制显示 binaryLabel。 */
export function formatCounts(file: Pick<TurnFileChange, 'insertions' | 'deletions' | 'binary'>, binaryLabel: string): string {
  if (file.binary)
    return binaryLabel
  const insertions = file.insertions ?? 0
  const deletions = file.deletions ?? 0
  return `+${insertions} -${deletions}`
}

/** 汇总的 `+N -M` 文本。 */
export function formatTotals(totals: { insertions: number, deletions: number }): string {
  return `+${totals.insertions} -${totals.deletions}`
}

/** 文件名（单文件卡片的标题用它）。 */
export function basename(path: string): string {
  const segments = path.split('/')
  return segments.at(-1) ?? path
}

/**
 * 卡片状态判定（纯函数）。
 * @param summary - 该会话的摘要；null 表示尚未取到。
 * @param turn - 本轮 turn 号。
 * @returns 卡片应呈现的状态（`hidden` 表示不占位）。
 */
export function resolveCardState(summary: SessionSummary | null, turn: number | undefined): TurnCardState {
  if (turn === undefined || !Number.isInteger(turn) || turn <= 0)
    return { kind: 'hidden' }
  if (summary === null)
    return { kind: 'hidden' }
  if (!summary.isGit) {
    // 非 Git：点撤销弹「需要 Git 仓库」说明；其它拒绝原因（家目录/盘根）只展示原因。
    return summary.unavailableReason !== null && summary.unavailableReason !== TURNREWIND_REASON_GIT_REQUIRED
      ? { kind: 'unavailable', reason: summary.unavailableReason }
      : { kind: 'git-required' }
  }
  const record = summary.turns.find(item => item.turn === turn)
  if (record === undefined)
    return { kind: 'hidden' }
  if (record.unavailable !== null && record.unavailable !== undefined)
    return { kind: 'failed', reason: record.unavailable }
  if (record.files.length === 0)
    return { kind: 'hidden' }
  if (record.undoneAt !== null && record.undoneAt !== undefined)
    return { kind: 'undone', record }
  return { kind: 'ready', record }
}

/** 卡片标题：单文件用文件名，多文件用数量。 */
export function cardTitle(record: Pick<TurnSummary, 'files'>, one: (name: string) => string, many: (count: number) => string): string {
  if (record.files.length === 1)
    return one(basename(record.files[0]?.path ?? ''))
  return many(record.files.length)
}

/**
 * 文件清单的折叠窗口。
 *
 * `hiddenCount` 始终按**折叠态**计算：展开后按钮必须继续存在（否则用户无法收起），
 * 因此不能用「当前可见行数」反推被隐藏的数量。
 *
 * @param files - 本 turn 的全部变更文件。
 * @param expanded - 是否已展开。
 * @param limit - 折叠时显示的行数上限。
 * @returns 当前应渲染的行，以及折叠时会隐藏的行数。
 */
export function fileListWindow(
  files: readonly TurnFileChange[],
  expanded: boolean,
  limit: number,
): { visible: readonly TurnFileChange[], hiddenCount: number } {
  const collapsed = files.slice(0, limit)
  return {
    visible: expanded ? files : collapsed,
    hiddenCount: files.length - collapsed.length,
  }
}
