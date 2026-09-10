/**
 * host/service/capture.ts — turn 生命周期编排：before 快照 → after 快照 → 差异 → 账本。
 *
 * 时机（两个内核都已核实）：
 *   - `agent/pre-step`（step === 1，waterfall，可 await）：**执行屏障**。本函数返回前，
 *     模型请求与任何工具都不会执行，因此 before 快照必然早于一切文件改动。
 *   - `session/event` 的 `turn/end`：after 快照与差异在**后台 FIFO**里结算，不阻塞
 *     turn 落定（与两个参考实现一致）；`agent/status → idle` 兜底被中断的 turn。
 *
 * 失败语义：任何捕获/统计失败都只写日志 + 账本里记 `unavailable`，绝不抛给 Agent 链路。
 * 并发语义：同一工作区的私有仓 index 是共享可变状态，所有快照操作经
 * {@link enqueueByWorkspace} 串行（不同工作区互不影响）。
 */

import type { SnapshotStore, TurnFileChange, TurnRecord } from '../types'
import {
  REASON_SNAPSHOT_FAILED,
  REASON_UNSAFE_WORKSPACE,
} from '../constants'
import { recordTurn, recordWorkspaceState } from './ledger'
import { captureSnapshot, diffTurnChanges, snapshotStoreFor, turnRef } from './snapshot'
import { probeWorkspace } from './workspace'

/** 一个正在进行中的 turn 的捕获状态。 */
interface ActiveTurn {
  sessionId: string
  turn: number
  workspaceRoot: string | null
  store: SnapshotStore | null
  beforeCommit: string | null
  /** 本 turn 不可撤销的原因（资格拒绝/快照失败）。 */
  skippedReason: string | null
}

/** 日志面（宿主 logger 的最小契约；缺失时静默）。 */
export interface CaptureLogger {
  warn?: (message: string) => void
  info?: (message: string) => void
}

export interface TurnCapture {
  /** pre-step 屏障：完成 before 快照（或明确标记不可撤销）。 */
  beginTurn: (sessionId: string, turn: number, cwd: unknown) => Promise<void>
  /** turn 结束后台结算：after 快照 + 差异 + 账本。 */
  settleTurn: (sessionId: string, turn: number) => Promise<void>
  /** 会话空闲兜底：结算该会话所有未落定的 turn。 */
  settleIdle: (sessionId: string) => Promise<void>
  /** 卸载：丢弃内存态（在飞任务由调用方等待）。 */
  dispose: () => void
}

function activeKey(sessionId: string, turn: number): string {
  return `${sessionId}:${turn}`
}

/**
 * 创建 turn 捕获编排器。
 * @param dshHome - 宿主数据根目录。
 * @param logger - 宿主 logger（可选）。
 * @param onCaptured - 账本写入成功后的回调（用于触发 hookable 钩子）。
 */
export function createTurnCapture(
  dshHome: string,
  logger: CaptureLogger | undefined,
  onCaptured?: (sessionId: string, turn: number, fileCount: number) => void,
): TurnCapture {
  const active = new Map<string, ActiveTurn>()
  const workspaceQueues = new Map<string, Promise<unknown>>()
  let disposed = false

  const warn = (message: string): void => {
    logger?.warn?.(`${message}`)
  }

  /** 按工作区串行执行任务（私有仓 index 是共享可变状态）。 */
  function enqueueByWorkspace<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = workspaceQueues.get(key) ?? Promise.resolve()
    const run = previous.then(task)
    workspaceQueues.set(key, run.catch(() => undefined))
    return run
  }

  async function beginTurn(sessionId: string, turn: number, cwd: unknown): Promise<void> {
    if (disposed)
      return
    const key = activeKey(sessionId, turn)
    if (active.has(key))
      return
    const probe = await probeWorkspace(cwd)
    if (!probe.ok) {
      // 非 Git / 系统目录：不建快照。资格结论写进账本供客户端呈现（非 Git 时点撤销弹窗）。
      // 家目录等「确实是 Git 仓库但禁止快照」的目录保持 isGit=true，只带不可用原因，
      // 避免客户端误报「需要 Git 仓库」。
      await recordWorkspaceState(dshHome, sessionId, {
        workspaceRoot: null,
        isGit: probe.reason === REASON_UNSAFE_WORKSPACE,
        unavailableReason: probe.reason,
      }).catch(() => undefined)
      active.set(key, { sessionId, turn, workspaceRoot: null, store: null, beforeCommit: null, skippedReason: probe.reason })
      return
    }
    const store = snapshotStoreFor(dshHome, probe.root)
    const result = await enqueueByWorkspace(probe.root, () =>
      captureSnapshot(store, turnRef(sessionId, turn, 'before'), `turn ${turn} before`))
    if (!result.ok) {
      warn(`dsh-tauri-turnrewind: before snapshot for session ${sessionId} turn ${turn} unavailable: ${result.reason}`)
      await recordWorkspaceState(dshHome, sessionId, {
        workspaceRoot: probe.root,
        isGit: true,
        unavailableReason: null,
      }).catch(() => undefined)
      active.set(key, { sessionId, turn, workspaceRoot: probe.root, store, beforeCommit: null, skippedReason: result.reason })
      return
    }
    await recordWorkspaceState(dshHome, sessionId, {
      workspaceRoot: probe.root,
      isGit: true,
      unavailableReason: null,
    }).catch(() => undefined)
    active.set(key, { sessionId, turn, workspaceRoot: probe.root, store, beforeCommit: result.commit, skippedReason: null })
  }

  async function settleTurn(sessionId: string, turn: number): Promise<void> {
    const key = activeKey(sessionId, turn)
    const entry = active.get(key)
    if (entry === undefined)
      return
    active.delete(key)
    if (entry.workspaceRoot === null || entry.store === null)
      return
    if (entry.beforeCommit === null) {
      await recordUnavailable(dshHome, sessionId, entry.turn, entry.skippedReason ?? REASON_SNAPSHOT_FAILED)
      return
    }
    const store = entry.store
    await enqueueByWorkspace(entry.workspaceRoot, async () => {
      const after = await captureSnapshot(store, turnRef(sessionId, turn, 'after'), `turn ${turn} after`)
      if (!after.ok) {
        await recordUnavailable(dshHome, sessionId, turn, after.reason)
        return
      }
      const diff = await diffTurnChanges(store, entry.beforeCommit as string, after.commit)
      if (!diff.ok) {
        await recordUnavailable(dshHome, sessionId, turn, REASON_SNAPSHOT_FAILED)
        return
      }
      const record = buildRecord(turn, sessionId, diff.changes)
      await recordTurn(dshHome, sessionId, record)
      onCaptured?.(sessionId, turn, record.files.length)
    })
  }

  async function settleIdle(sessionId: string): Promise<void> {
    for (const entry of [...active.values()]) {
      if (entry.sessionId !== sessionId)
        continue
      await settleTurn(sessionId, entry.turn)
    }
  }

  return {
    beginTurn,
    settleTurn,
    settleIdle,
    dispose(): void {
      disposed = true
      active.clear()
    },
  }
}

function buildRecord(turn: number, sessionId: string, files: TurnFileChange[]): TurnRecord {
  let insertions = 0
  let deletions = 0
  for (const file of files) {
    insertions += file.insertions ?? 0
    deletions += file.deletions ?? 0
  }
  return {
    turn,
    // 账本只留 ref：commit oid 由 ref 解析（撤销前会重新 rev-parse 校验），
    // 避免账本与仓库状态出现两份可能漂移的真相。
    beforeRef: turnRef(sessionId, turn, 'before'),
    afterRef: turnRef(sessionId, turn, 'after'),
    files,
    insertions,
    deletions,
    createdAt: Date.now(),
    undoneAt: null,
    unavailable: null,
  }
}

/** 记录一个不可撤销的 turn（快照失败/超限），保留原因供卡片呈现。 */
async function recordUnavailable(dshHome: string, sessionId: string, turn: number, reason: string): Promise<void> {
  await recordTurn(dshHome, sessionId, {
    turn,
    beforeRef: '',
    afterRef: '',
    files: [],
    insertions: 0,
    deletions: 0,
    createdAt: Date.now(),
    undoneAt: null,
    unavailable: reason,
  })
}
