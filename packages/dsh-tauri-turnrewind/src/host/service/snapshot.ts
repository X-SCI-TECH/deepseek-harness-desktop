/**
 * host/service/snapshot.ts — 每个工作区一个**私有 Git 快照仓**的捕获 / 差异 / 恢复引擎。
 *
 * 设计要点（与归档 demo 的差异见 docs/plugins/11.优化计划.turnrewind实现.md §2.3）：
 *   - 私有仓自包含（不借源仓库对象、不用 alternates），源仓库 `git gc --prune=now`
 *     不会破坏快照，因此不需要「对象连通性自检 + 删仓重建基线」那套自愈；
 *   - 私有仓自带 index（stat 缓存让 `add --all` 在后续轮次天然增量），首轮从空 index 开始；
 *   - 源仓库只做只读探测：同步 `core.autocrlf` / `core.eol` / `core.symlinks` 与
 *     `.git/info/exclude`，让「比较」与「恢复」跟用户仓库的换行/属性语义一致，
 *     否则 CRLF 工作区会把每个文件都误判成冲突；
 *   - 一切写操作都指向私有仓与私有 index，用户仓库的 HEAD / 分支 / index / stash 不变。
 */

import type { GitResult, SnapshotStore, TurnFileChange } from '../types'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'pathe'
import {
  MAX_FILES_PER_SNAPSHOT,
  MAX_SNAPSHOT_BYTES,
  REASON_SNAPSHOT_FAILED,
  REASON_SNAPSHOT_TOO_LARGE,
  REASON_TOO_MANY_FILES,
  SNAPSHOT_FEATURE_DIR,
  SNAPSHOT_REF_PREFIX,
} from '../constants'
import { gitInRepo, gitInSnapshot, resolveSourceCommonDir } from './git'
import { workspaceHash } from './workspace'

/** commit-tree 的身份（私有仓的提交只做锚点，不代表用户，故用固定身份）。 */
const SNAPSHOT_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: 'DSH Turn Rewind',
  GIT_AUTHOR_EMAIL: 'turnrewind@localhost',
  GIT_COMMITTER_NAME: 'DSH Turn Rewind',
  GIT_COMMITTER_EMAIL: 'turnrewind@localhost',
}

/** 随源仓库同步的配置键：影响 add 的归一化与 checkout 的还原方式。 */
const MIRRORED_CONFIG_KEYS = ['core.autocrlf', 'core.eol', 'core.symlinks']

/** 一次 checkout 调用携带的最大路径数（Windows argv 上限友好）。 */
const CHECKOUT_CHUNK = 200

export type CaptureResult = { ok: true, commit: string } | { ok: false, reason: string }

/** 运行中实时读数的形态（供客户端「运行中」提示条渲染）。 */
export interface LiveStats {
  /** 当前已受影响的文件数。 */
  fileCount: number
  /** 累计新增行数（二进制不计）。 */
  insertions: number
  /** 累计删除行数（二进制不计）。 */
  deletions: number
}

/** 快照仓根目录（DSH_HOME 下）。 */
export function snapshotWorkspacesDir(dshHome: string): string {
  return join(dshHome, SNAPSHOT_FEATURE_DIR, 'workspaces')
}

/** 某工作区对应的私有快照仓定位。 */
export function snapshotStoreFor(dshHome: string, worktree: string): SnapshotStore {
  return {
    worktree,
    gitDir: join(snapshotWorkspacesDir(dshHome), `${workspaceHash(worktree)}.git`),
  }
}

/** 快照 ref 名；会话 id 先做文件系统/ref 安全化，再拼短哈希防撞。 */
export function turnRef(sessionId: string, turn: number, phase: 'before' | 'after'): string {
  const sanitized = sessionId.replace(/[^\w.-]/g, '_').slice(0, 64) || 'session'
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
  return `${SNAPSHOT_REF_PREFIX}/${sanitized}-${digest}/${turn}/${phase}`
}

function splitNul(value: string): string[] {
  if (value.length === 0)
    return []
  const parts = value.split('\0')
  if (parts.at(-1) === '')
    parts.pop()
  return parts
}

/**
 * 把相对路径解析到工作区内；越界（绝对路径、`..` 逃逸）返回 null。
 * 撤销与恢复路径共用，任何来自 git 输出的路径都先过这里。
 */
export function resolveInsideWorkspace(worktree: string, path: string): string | null {
  if (path.length === 0 || path.includes('\0') || isAbsolute(path))
    return null
  const absolute = resolve(worktree, path)
  const rel = relative(worktree, absolute)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel))
    return null
  return absolute
}

/** 私有快照仓是否已初始化。 */
function repoExists(store: SnapshotStore): boolean {
  return existsSync(join(store.gitDir, 'HEAD'))
}

/** 首次使用时初始化私有快照仓，并把源仓库的换行/属性配置镜像进来。 */
export async function ensureSnapshotRepo(store: SnapshotStore): Promise<GitResult> {
  if (!repoExists(store)) {
    // 私有仓用 `--bare` 初始化：`git init <path>.git` 会在 `<path>.git` 里再套一层
    // `.git`，而 `--git-dir` 需要目录本身就是 git dir。父目录必须先存在，否则
    // execFile 以不存在的 cwd 启动会直接 ENOENT。
    const parent = dirname(store.gitDir)
    await mkdir(parent, { recursive: true })
    const init = await gitInRepo(parent, ['init', '--bare', '--quiet', store.gitDir])
    if (!init.ok)
      return init
  }
  // 让 git dir 与工作区配对：`--work-tree` 每次显式传入，这里落一份持久配置作兜底。
  await gitInSnapshot(store, ['config', 'core.bare', 'false'])
  const configured = await gitInSnapshot(store, ['config', 'core.worktree', store.worktree])
  if (!configured.ok)
    return configured
  // 私有仓不做自动 gc：对象由 refs 钉住，避免后台回收与撤销抢锁。
  await gitInSnapshot(store, ['config', 'gc.auto', '0'])
  for (const key of MIRRORED_CONFIG_KEYS) {
    const value = await gitInRepo(store.worktree, ['config', '--get', key])
    const trimmed = value.ok ? value.out.trim() : ''
    if (trimmed.length > 0)
      await gitInSnapshot(store, ['config', key, trimmed])
  }
  await syncSourceExclude(store)
  return { ok: true, out: '' }
}

/** 把源仓库 `.git/info/exclude` 的内容同步进私有仓（忽略规则语义对齐，best-effort）。 */
async function syncSourceExclude(store: SnapshotStore): Promise<void> {
  const commonDir = await resolveSourceCommonDir(store.worktree)
  if (commonDir === null)
    return
  const absoluteCommon = isAbsolute(commonDir) ? commonDir : resolve(store.worktree, commonDir)
  const sourceFile = join(absoluteCommon, 'info', 'exclude')
  if (!existsSync(sourceFile))
    return
  // 写的是**私有仓**自己的 info/exclude：私有仓的 GIT_DIR 与源仓库不同，
  // 源仓库的 exclude 不会被自动读取，必须显式镜像过来。
  const target = join(store.gitDir, 'info', 'exclude')
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(sourceFile, 'utf8'), 'utf8')
  }
  catch {
    /* 同步失败不影响快照：只是忽略规则可能少一条 */
  }
}

interface TreeStats {
  files: number
  bytes: number
}

/** 统计一棵树的文件数与聚合字节数（`ls-tree -r -l` 的 size 列为 blob 大小）。 */
async function treeStats(store: SnapshotStore, commitOrTree: string): Promise<{ ok: true, stats: TreeStats } | { ok: false, reason: string }> {
  const listed = await gitInSnapshot(store, ['ls-tree', '-r', '-l', '-z', commitOrTree])
  if (!listed.ok)
    return { ok: false, reason: listed.error }
  let files = 0
  let bytes = 0
  for (const record of splitNul(listed.out)) {
    const match = /^(\d{6}) (\w+) ([0-9a-f]+)\s+(\d+)\t([\s\S]+)$/.exec(record)
    if (match === null) {
      // 子模块（gitlink，无 size 列）与其它非 blob 条目：计入文件数，不计字节。
      files += 1
      continue
    }
    files += 1
    bytes += Number(match[4])
  }
  return { ok: true, stats: { files, bytes } }
}

/**
 * 捕获一次快照：`add --all` → `write-tree` → `commit-tree` → `update-ref`。
 * @param store - 私有快照仓。
 * @param ref - 目标 ref（见 {@link turnRef}）。
 * @param message - commit message（诊断可读）。
 * @returns 成功时返回 commit oid；失败时返回不可用原因。
 */
export async function captureSnapshot(store: SnapshotStore, ref: string, message: string): Promise<CaptureResult> {
  const ready = await ensureSnapshotRepo(store)
  if (!ready.ok)
    return { ok: false, reason: REASON_SNAPSHOT_FAILED }
  const added = await gitInSnapshot(store, ['add', '--all', '--', '.'])
  if (!added.ok)
    return { ok: false, reason: REASON_SNAPSHOT_FAILED }
  const tree = await gitInSnapshot(store, ['write-tree'])
  if (!tree.ok)
    return { ok: false, reason: REASON_SNAPSHOT_FAILED }
  const treeOid = tree.out.trim()
  const stats = await treeStats(store, treeOid)
  if (!stats.ok)
    return { ok: false, reason: REASON_SNAPSHOT_FAILED }
  if (stats.stats.files > MAX_FILES_PER_SNAPSHOT)
    return { ok: false, reason: REASON_TOO_MANY_FILES }
  if (stats.stats.bytes > MAX_SNAPSHOT_BYTES)
    return { ok: false, reason: REASON_SNAPSHOT_TOO_LARGE }
  const commit = await gitInSnapshot(store, ['commit-tree', treeOid, '-m', message], { env: SNAPSHOT_IDENTITY })
  if (!commit.ok)
    return { ok: false, reason: REASON_SNAPSHOT_FAILED }
  const commitOid = commit.out.trim()
  const updated = await gitInSnapshot(store, ['update-ref', ref, commitOid])
  if (!updated.ok)
    return { ok: false, reason: REASON_SNAPSHOT_FAILED }
  return { ok: true, commit: commitOid }
}

/** 解析 ref 指向的 commit；不存在返回 null。 */
export async function readRefCommit(store: SnapshotStore, ref: string): Promise<string | null> {
  const result = await gitInSnapshot(store, ['rev-parse', '--verify', '--quiet', ref])
  if (!result.ok)
    return null
  const oid = result.out.trim()
  return oid.length > 0 ? oid : null
}

/** 删除快照 ref（账本淘汰 / 撤销后清理），失败忽略。 */
export async function deleteRefs(store: SnapshotStore, refs: readonly string[]): Promise<void> {
  for (const ref of refs)
    await gitInSnapshot(store, ['update-ref', '-d', ref])
}

/** 列出某 commit 下的全部路径集合。 */
async function treePaths(store: SnapshotStore, commit: string): Promise<{ ok: true, paths: Set<string> } | { ok: false, reason: string }> {
  const listed = await gitInSnapshot(store, ['ls-tree', '-r', '-z', '--name-only', commit])
  if (!listed.ok)
    return { ok: false, reason: listed.error }
  return { ok: true, paths: new Set(splitNul(listed.out)) }
}

/**
 * 计算两个快照之间的逐文件差异（`+N -M` 与新增/修改/删除）。
 * 状态由两侧路径集合推导：只看 after 有=A，只看 before 有=D，两侧都有=M。
 */
export async function diffTurnChanges(store: SnapshotStore, beforeCommit: string, afterCommit: string): Promise<{ ok: true, changes: TurnFileChange[] } | { ok: false, reason: string }> {
  const [before, after, numstat] = await Promise.all([
    treePaths(store, beforeCommit),
    treePaths(store, afterCommit),
    gitInSnapshot(store, ['diff', '--numstat', '-z', '--no-renames', beforeCommit, afterCommit]),
  ])
  if (!before.ok)
    return { ok: false, reason: before.reason }
  if (!after.ok)
    return { ok: false, reason: after.reason }
  if (!numstat.ok)
    return { ok: false, reason: numstat.error }
  const changes: TurnFileChange[] = []
  for (const record of splitNul(numstat.out)) {
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0)
      continue
    const rawInsertions = record.slice(0, firstTab)
    const rawDeletions = record.slice(firstTab + 1, secondTab)
    const path = record.slice(secondTab + 1)
    if (path.length === 0)
      continue
    const binary = rawInsertions === '-' || rawDeletions === '-'
    changes.push({
      path,
      status: !before.paths.has(path) ? 'A' : !after.paths.has(path) ? 'D' : 'M',
      insertions: binary ? null : Number(rawInsertions),
      deletions: binary ? null : Number(rawDeletions),
      binary,
    })
  }
  changes.sort((left, right) => left.path.localeCompare(right.path))
  return { ok: true, changes }
}

/**
 * 运行中实时统计：刷新私有 index 后与 before 快照比较当前工作区。
 *
 * 必须先 `add --all` 再 diff：`git diff <commit>` 只认提交与 index 里出现过的路径，
 * 本轮**新建**的文件在 index 里还不存在（捕获只在 before/after 两处写 index），
 * 不刷新就会漏掉它们——而「刚创建文件」正是运行中提示最需要反馈的场景。
 * 刷新只动私有 index，用户仓库不受影响。
 *
 * @param store - 私有快照仓。
 * @param beforeCommit - 本轮 before 快照的 commit。
 * @returns 受影响文件数与行数汇总；失败返回原因（调用方保持上一次读数）。
 */
export async function liveDiff(store: SnapshotStore, beforeCommit: string): Promise<{ ok: true, stats: LiveStats } | { ok: false, reason: string }> {
  const added = await gitInSnapshot(store, ['add', '--all', '--', '.'])
  if (!added.ok)
    return { ok: false, reason: added.error }
  const numstat = await gitInSnapshot(store, ['diff', '--numstat', '-z', '--no-renames', beforeCommit])
  if (!numstat.ok)
    return { ok: false, reason: numstat.error }
  let fileCount = 0
  let insertions = 0
  let deletions = 0
  for (const record of splitNul(numstat.out)) {
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0)
      continue
    fileCount += 1
    const rawInsertions = record.slice(0, firstTab)
    const rawDeletions = record.slice(firstTab + 1, secondTab)
    if (rawInsertions === '-' || rawDeletions === '-')
      continue
    insertions += Number(rawInsertions)
    deletions += Number(rawDeletions)
  }
  return { ok: true, stats: { fileCount, insertions, deletions } }
}

/**
 * 冲突预检：找出「当前磁盘内容 != 该 turn 结束时的快照」的路径。
 *
 * 用 `git diff <afterCommit> -- <paths>`（而非自己算哈希）比较，比较过程与快照
 * 写入共用同一套换行/属性归一化，CRLF 工作区不会被误判。删除态（D）另补一条
 * 存在性检查：路径既不在 after 快照也不在私有 index 里时，git diff 看不到
 * 用户后来重建的同名文件，必须显式拦住，否则撤销会静默覆盖它。
 */
export async function conflictPaths(store: SnapshotStore, afterCommit: string, changes: readonly TurnFileChange[]): Promise<{ ok: true, paths: string[] } | { ok: false, reason: string }> {
  const conflicting = new Set<string>()
  const tracked = changes.filter(change => change.status !== 'D').map(change => change.path)
  if (tracked.length > 0) {
    const diff = await gitInSnapshot(store, ['diff', '--name-only', '-z', '--no-renames', afterCommit, '--', ...tracked])
    if (!diff.ok)
      return { ok: false, reason: diff.error }
    for (const path of splitNul(diff.out))
      conflicting.add(path)
  }
  for (const change of changes) {
    if (change.status !== 'D')
      continue
    const absolute = resolveInsideWorkspace(store.worktree, change.path)
    if (absolute !== null && existsSync(absolute))
      conflicting.add(change.path)
  }
  return { ok: true, paths: [...conflicting] }
}

/** 从删除点向上清理空目录（止于工作区根；目录非空即停）。 */
async function pruneEmptyParents(worktree: string, absolutePath: string): Promise<void> {
  let current = dirname(absolutePath)
  while (current.length > 0 && resolve(current) !== resolve(worktree)) {
    try {
      await rmdir(current)
    }
    catch {
      return
    }
    current = dirname(current)
  }
}

export interface RestoreReport {
  restored: string[]
  removed: string[]
  failed: Array<{ path: string, reason: string }>
}

/**
 * 执行恢复：修改/删除的文件从 before 快照 checkout 回来，本 turn 新增的文件删除。
 * 单路径失败只计入 `failed`，不影响其余路径（调用方如实上报，不谎报成功）。
 */
export async function restoreTurnChanges(store: SnapshotStore, beforeCommit: string, changes: readonly TurnFileChange[]): Promise<RestoreReport> {
  const report: RestoreReport = { restored: [], removed: [], failed: [] }
  const restorable: string[] = []
  for (const change of changes) {
    if (change.status === 'A')
      continue
    if (resolveInsideWorkspace(store.worktree, change.path) === null) {
      report.failed.push({ path: change.path, reason: '路径越界，拒绝恢复' })
      continue
    }
    restorable.push(change.path)
  }
  for (let index = 0; index < restorable.length; index += CHECKOUT_CHUNK) {
    const chunk = restorable.slice(index, index + CHECKOUT_CHUNK)
    const checkout = await gitInSnapshot(store, ['checkout', beforeCommit, '--', ...chunk])
    if (checkout.ok) {
      report.restored.push(...chunk)
      continue
    }
    // 整块失败时退化为逐路径重试，精确定位失败项。
    for (const path of chunk) {
      const single = await gitInSnapshot(store, ['checkout', beforeCommit, '--', path])
      if (single.ok)
        report.restored.push(path)
      else
        report.failed.push({ path, reason: single.error })
    }
  }
  for (const change of changes) {
    if (change.status !== 'A')
      continue
    const absolute = resolveInsideWorkspace(store.worktree, change.path)
    if (absolute === null) {
      report.failed.push({ path: change.path, reason: '路径越界，拒绝删除' })
      continue
    }
    try {
      await unlink(absolute)
      await pruneEmptyParents(store.worktree, absolute)
      report.removed.push(change.path)
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        // 文件已经不在了：按「已删除」结算，不算失败。
        report.removed.push(change.path)
        continue
      }
      report.failed.push({ path: change.path, reason: String((error as Error)?.message ?? error) })
    }
  }
  return report
}
