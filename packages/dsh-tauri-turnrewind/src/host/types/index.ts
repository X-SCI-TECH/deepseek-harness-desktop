/**
 * host/types/index.ts — 宿主侧共享类型。
 *
 * HostContext 保持结构化 any（与 dsh-tauri-worktree 同口径）：宿主服务的完整类型由
 * 各内核版本自带，本插件只消费已核实存在的成员，避免把某一版的类型钉进构建。
 */

export type HostContext = any

export type JsonBody = Record<string, unknown>

/** 一次 git 子进程的结果；捕获/撤销路径从不抛异常，失败一律走该联合。 */
export type GitResult = { ok: true, out: string } | { ok: false, error: string }

/** 单个工作区私有快照仓的定位信息。 */
export interface SnapshotStore {
  /** 会话工作区（Git worktree 根）。 */
  worktree: string
  /** 私有快照仓目录（`$DSH_HOME/<feature>/workspaces/<hash>.git`）。 */
  gitDir: string
}

/** 工作区资格探测结果。 */
export type WorkspaceProbe = { ok: true, root: string } | { ok: false, reason: string }

/** 一个 turn 内的单文件差异。 */
export interface TurnFileChange {
  /** 相对 worktree 根的路径。 */
  path: string
  /** A=本 turn 新增，M=修改，D=删除。 */
  status: 'A' | 'M' | 'D'
  /** 文本行新增数；二进制为 null。 */
  insertions: number | null
  /** 文本行删除数；二进制为 null。 */
  deletions: number | null
  /** 是否为二进制差异。 */
  binary: boolean
}

/** 一个 turn 的变更记录（账本行）。 */
export interface TurnRecord {
  turn: number
  beforeRef: string
  afterRef: string
  files: TurnFileChange[]
  insertions: number
  deletions: number
  createdAt: number
  /** 已撤销时间戳；null/缺省表示未撤销。 */
  undoneAt?: number | null
  /** 不可用原因（超限/失败）；非空表示该 turn 无可用快照。 */
  unavailable?: string | null
}

/** 每会话账本文件的结构。 */
export interface SessionLedger {
  version: number
  sessionId: string
  /** 已解析的 worktree 根；非 Git 会话为 null。 */
  workspaceRoot: string | null
  /** 会话 cwd 是否位于 Git worktree 内。 */
  isGit: boolean
  unavailableReason: string | null
  turns: TurnRecord[]
}

/** 撤销前的冲突明细。 */
export interface UndoConflict {
  path: string
  /** 冲突原因（人类可读，用于卡片展示）。 */
  reason: string
}

/** 撤销结果。 */
export type UndoOutcome
  = | { ok: true, restored: string[], removed: string[], failed: Array<{ path: string, reason: string }> }
    | { ok: false, code: number, error: string, conflicts?: UndoConflict[] }

/** 客户端 summary 路由的载荷（turns 为账本记录的摘要投影）。 */
export interface SummaryPayload {
  sessionId: string
  isGit: boolean
  workspaceRoot: string | null
  unavailableReason: string | null
  turns: Array<{
    turn: number
    fileCount: number
    insertions: number
    deletions: number
    undoneAt: number | null
    unavailable: string | null
    truncated: boolean
    files: TurnFileChange[]
  }>
}
