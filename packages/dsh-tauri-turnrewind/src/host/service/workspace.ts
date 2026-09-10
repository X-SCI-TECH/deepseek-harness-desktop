/**
 * host/service/workspace.ts — 会话工作区解析、规范化与资格守卫。
 *
 * 三条判定集中在此，路由与捕获路径共用：
 *   1. 会话 cwd 必须位于 Git worktree 内（否则 `TURNREWIND_GIT_REQUIRED`）；
 *   2. 家目录本身、家目录祖先、任何盘根一律拒绝（`TURNREWIND_UNSAFE_WORKSPACE`）——
 *      这类目录做快照既有灾难风险又没有撤销价值；
 *   3. 快照域是 **worktree 根**，会话 cwd 是子目录时归并到根，同一仓库共享一个快照域。
 *
 * 绝不使用 `process.cwd()` 兜底：宿主进程的工作目录未必是会话工作区，
 * 猜错会把不相关的仓库当成快照域（AGENTS.plugins.md 宿主侧规则）。
 */

import type { WorkspaceProbe } from '../types'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import process from 'node:process'
import { parse, resolve } from 'pathe'
import { REASON_GIT_REQUIRED, REASON_UNSAFE_WORKSPACE } from '../constants'
import { gitInRepo } from './git'

/** 解析为磁盘上的真实路径（符号链接/短名归一）；路径不存在时退回 resolve 结果。 */
export function canonicalWorkspacePath(target: string): string {
  const resolved = resolve(target)
  try {
    const native = process.platform === 'win32' ? resolved.replaceAll('/', '\\') : resolved
    return resolve(realpathSync.native(native))
  }
  catch {
    return resolved
  }
}

/**
 * 快照域的键：规范化后再做大小写折叠。
 * Windows 文件系统大小写不敏感，`C:\Repo` 与 `c:\repo` 必须折叠成同一个域，
 * 否则同一个工作区会分裂出两个私有快照仓。
 */
export function workspaceKey(target: string): string {
  const canonical = canonicalWorkspacePath(target)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/** 工作区键的短哈希（私有快照仓目录名）。 */
export function workspaceHash(target: string): string {
  return createHash('sha256').update(workspaceKey(target)).digest('hex').slice(0, 24)
}

/** 是否为系统级敏感目录（家目录本身、家目录祖先、盘根）。 */
export function isSystemSensitivePath(target: string): boolean {
  const canonical = workspaceKey(target)
  if (canonical.length === 0)
    return true
  const home = workspaceKey(homedir())
  if (canonical === home)
    return true
  const homePrefix = canonical.endsWith('/') ? canonical : `${canonical}/`
  if (home.startsWith(homePrefix))
    return true
  const root = parse(canonical).root
  const trimmedRoot = root.endsWith('/') ? root.slice(0, -1) : root
  return canonical === root || canonical === trimmedRoot
}

/**
 * 探测会话工作区资格。
 * @param cwd - 会话 header 的 cwd；缺失时按「非 Git」处理（不猜测进程工作目录）。
 * @returns 通过时为 worktree 根，否则为拒绝原因。
 */
export async function probeWorkspace(cwd: unknown): Promise<WorkspaceProbe> {
  if (typeof cwd !== 'string' || cwd.length === 0)
    return { ok: false, reason: REASON_GIT_REQUIRED }
  if (isSystemSensitivePath(cwd))
    return { ok: false, reason: REASON_UNSAFE_WORKSPACE }
  const top = await gitInRepo(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok)
    return { ok: false, reason: REASON_GIT_REQUIRED }
  const root = canonicalWorkspacePath(top.out.trim())
  if (root.length === 0)
    return { ok: false, reason: REASON_GIT_REQUIRED }
  if (isSystemSensitivePath(root))
    return { ok: false, reason: REASON_UNSAFE_WORKSPACE }
  return { ok: true, root }
}

/** 从会话对象上读取 cwd（header.cwd 优先，兼容 session.cwd）。 */
export function sessionCwdOf(session: any): string | null {
  const cwd = typeof session?.header?.cwd === 'string'
    ? session.header.cwd
    : typeof session?.cwd === 'string'
      ? session.cwd
      : ''
  return cwd.length > 0 ? cwd : null
}

/** 宿主 SessionStore 中查找会话；找不到返回 undefined（调用方按未知处理）。 */
export function findSession(ctx: any, sessionId: string): any {
  if (!sessionId)
    return undefined
  try {
    return ctx.sessions?.get?.(sessionId)
      ?? ctx.sessions?.list?.().find((session: any) => session?.id === sessionId)
  }
  catch {
    return undefined
  }
}
