/**
 * host/constants/index.ts — 宿主侧私有常量。
 *
 * 上限与错误码集中在此：捕获路径、撤销路径与路由共用同一组判定，
 * 避免「预览说超限、执行却照做」这类双份常量漂移。
 */

import { TURNREWIND_PLUGIN_NAME } from '../../shared/constants'

export { TURNREWIND_API_PREFIX, TURNREWIND_PLUGIN_NAME } from '../../shared/constants'

/** 私有快照仓中快照 ref 的命名空间前缀。 */
export const SNAPSHOT_REF_PREFIX = 'refs/turnrewind'

/** 每个工作区私有快照仓的存放目录（DSH_HOME 下）。 */
export const SNAPSHOT_FEATURE_DIR = TURNREWIND_PLUGIN_NAME

/** 账本文件版本；字段或折叠语义变更时递增。 */
export const LEDGER_VERSION = 1

/** 单 turn 允许纳入快照的最大文件数；超过即该 turn 记 unavailable。 */
export const MAX_FILES_PER_SNAPSHOT = 5000

/** 单个文件的最大字节数（捕获与恢复对称）。 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024

/** 单次快照的聚合字节上限。 */
export const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024

/** 每会话保留的 turn 记录条数；超出丢弃最早的记录及其 refs。 */
export const MAX_TURNS_PER_SESSION = 200

/** 单条 git 子进程的墙钟超时。 */
export const GIT_TIMEOUT_MS = 5 * 60 * 1000

/** 摘要路由返回给客户端的文件明细上限（更大的会话只给汇总与截断标记）。 */
export const MAX_SUMMARY_FILES = 200

/** 会话 cwd 不在 Git worktree 内：不做快照，撤销入口提示需要 Git 仓库。 */
export const REASON_GIT_REQUIRED = 'TURNREWIND_GIT_REQUIRED'

/** 会话 cwd 是家目录/家目录祖先/盘根等系统目录：拒绝快照。 */
export const REASON_UNSAFE_WORKSPACE = 'TURNREWIND_UNSAFE_WORKSPACE'

/** 快照文件数超限。 */
export const REASON_TOO_MANY_FILES = 'TURNREWIND_TOO_MANY_FILES'

/** 快照聚合字节超限。 */
export const REASON_SNAPSHOT_TOO_LARGE = 'TURNREWIND_SNAPSHOT_TOO_LARGE'

/** 快照或统计过程失败（git 不可用、仓库损坏等）。 */
export const REASON_SNAPSHOT_FAILED = 'TURNREWIND_SNAPSHOT_FAILED'

/** 撤销被并发修改拦截。 */
export const REASON_CONFLICT = 'TURNREWIND_CONFLICT'

/** 该 turn 的产物已被一次性撤销，不能重复撤销。 */
export const REASON_ALREADY_UNDONE = 'TURNREWIND_ALREADY_UNDONE'
