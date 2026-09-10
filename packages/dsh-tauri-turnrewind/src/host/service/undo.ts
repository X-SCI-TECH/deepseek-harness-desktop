/**
 * host/service/undo.ts — 撤销一个 turn 的工作区改动。
 *
 * 顺序固定为「读账本 → 校验归属 → 校验快照可用 → **冲突预检** → 恢复 → 回写账本」：
 * 预检在动任何文件之前完成，命中冲突时不写一个字节（AGENTS.plugins.md
 * 「不得静默覆盖用户已有改动」）。恢复过程不做 force 通道，部分失败如实上报且
 * **不标记已撤销**，用户可以再点一次。
 */

import type { UndoConflict, UndoOutcome } from '../types'
import { REASON_ALREADY_UNDONE, REASON_CONFLICT, REASON_GIT_REQUIRED, REASON_SNAPSHOT_FAILED } from '../constants'
import { markTurnUndone, readLedger } from './ledger'
import { conflictPaths, readRefCommit, restoreTurnChanges, snapshotStoreFor } from './snapshot'
import { workspaceKey } from './workspace'

/** 撤销入参。 */
export interface UndoTurnOptions {
  /** 宿主数据根目录（`$DSH_HOME`）。 */
  dshHome: string
  sessionId: string
  turn: number
  /** 会话当前解析出的 worktree 根；用于会话归属校验（null 表示当前无法解析）。 */
  currentWorkspace: string | null
}

/**
 * 撤销指定 turn。
 * @param options - 会话、turn 与当前工作区。
 * @returns 成功时给出已恢复/已删除/失败明细；失败时给出 HTTP 状态码与原因。
 */
export async function undoTurn(options: UndoTurnOptions): Promise<UndoOutcome> {
  const { dshHome, sessionId, turn, currentWorkspace } = options
  const ledger = await readLedger(dshHome, sessionId)
  const record = ledger.turns.find(item => item.turn === turn)
  if (record === undefined)
    return { ok: false, code: 404, error: '未找到该轮的文件变更记录' }
  if (!ledger.isGit || ledger.workspaceRoot === null)
    return { ok: false, code: 409, error: ledger.unavailableReason ?? REASON_GIT_REQUIRED }
  if (record.unavailable)
    return { ok: false, code: 409, error: record.unavailable }
  if (record.undoneAt !== null && record.undoneAt !== undefined)
    return { ok: false, code: 409, error: REASON_ALREADY_UNDONE }
  // 会话归属：cwd 可能后来被切到别的工作区，此时账本里的相对路径不再指向同一目录。
  if (currentWorkspace !== null && workspaceKey(currentWorkspace) !== workspaceKey(ledger.workspaceRoot))
    return { ok: false, code: 403, error: '会话当前工作区与该轮记录不一致，拒绝撤销' }

  const store = snapshotStoreFor(dshHome, ledger.workspaceRoot)
  const beforeCommit = await readRefCommit(store, record.beforeRef)
  const afterCommit = await readRefCommit(store, record.afterRef)
  if (beforeCommit === null || afterCommit === null)
    return { ok: false, code: 409, error: REASON_SNAPSHOT_FAILED }

  if (record.files.length === 0) {
    await markTurnUndone(dshHome, sessionId, turn, Date.now())
    return { ok: true, restored: [], removed: [], failed: [] }
  }

  const conflicts = await conflictPaths(store, afterCommit, record.files)
  if (!conflicts.ok)
    return { ok: false, code: 500, error: conflicts.reason }
  if (conflicts.paths.length > 0) {
    const details: UndoConflict[] = conflicts.paths.map(path => ({
      path,
      reason: '该文件在 turn 结束后又被修改过',
    }))
    return { ok: false, code: 409, error: REASON_CONFLICT, conflicts: details }
  }

  const report = await restoreTurnChanges(store, beforeCommit, record.files)
  if (report.failed.length === 0)
    await markTurnUndone(dshHome, sessionId, turn, Date.now())
  return { ok: true, restored: report.restored, removed: report.removed, failed: report.failed }
}
