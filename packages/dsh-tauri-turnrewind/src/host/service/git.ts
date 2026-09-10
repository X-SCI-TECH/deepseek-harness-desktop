/**
 * host/service/git.ts — git 子进程封装。
 *
 * 两种调用面严格区分，二者都不抛异常（失败一律返回 `{ ok: false }`），
 * 让上层能按「捕获失败不得打断 Agent turn」的语义处理：
 *   - `gitInRepo`：在**用户仓库**里执行**只读**探测（rev-parse / rev-parse --git-common-dir）。
 *     绝不执行任何写命令——本插件对用户仓库只读是硬契约（有零污染测试钉住）。
 *   - `gitInSnapshot`：在**私有快照仓**里执行读写（add / write-tree / commit-tree /
 *     update-ref / diff / ls-tree / checkout / cat-file / hash-object）。所有写操作都落
 *     在私有仓与私有 index 上，用户仓库的 HEAD / 分支 / index / stash 不受影响。
 */

import type { GitResult, SnapshotStore } from '../types'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { GIT_TIMEOUT_MS } from '../constants'

/** 单次 git 调用的可选项。 */
export interface GitRunOptions {
  /** 写入 stdin 的内容（`--stdin` 类命令）。 */
  input?: string
  /** 追加/覆盖的环境变量。 */
  env?: Record<string, string>
  /** 墙钟超时；缺省 5 分钟。 */
  timeoutMs?: number
}

/** git 输出缓冲上限：快照/差异输出可能很大，但仍需有界。 */
const GIT_MAX_BUFFER = 64 * 1024 * 1024

function execGit(cwd: string, args: string[], options: GitRunOptions): Promise<GitResult> {
  return new Promise<GitResult>((resolve) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
        timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          ...options.env,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message || error).trim()
          resolve({ ok: false, error: message })
          return
        }
        resolve({ ok: true, out: String(stdout ?? '') })
      },
    )
    // execFile 的 stdin 是管道：不给输入时必须显式结束，否则等待 stdin 的命令会挂到超时。
    child.stdin?.end(options.input ?? '')
  })
}

/** 在私有快照仓中执行（git-dir = 私有仓，work-tree = 会话工作区，cwd = 工作区）。 */
export function gitInSnapshot(store: SnapshotStore, args: string[], options: GitRunOptions = {}): Promise<GitResult> {
  return execGit(store.worktree, ['--git-dir', store.gitDir, '--work-tree', store.worktree, ...args], options)
}

/** 在用户仓库中执行只读探测（不覆盖 git-dir，由 git 自行发现仓库）。 */
export function gitInRepo(cwd: string, args: string[], options: GitRunOptions = {}): Promise<GitResult> {
  return execGit(cwd, args, options)
}

/** 解析源仓库的 common dir（用于同步 `.git/info/exclude`）；失败返回 null。 */
export async function resolveSourceCommonDir(worktree: string): Promise<string | null> {
  const result = await gitInRepo(worktree, ['rev-parse', '--git-common-dir'])
  if (!result.ok)
    return null
  const value = result.out.trim()
  if (value.length === 0)
    return null
  // `--git-common-dir` 可能是相对 worktree 的路径（如 `.git`）。
  return value
}
