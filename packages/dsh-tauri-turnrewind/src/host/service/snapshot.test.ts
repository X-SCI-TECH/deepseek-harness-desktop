import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { join } from 'pathe'
import { afterEach, describe, expect, it } from 'vitest'
import { gitInSnapshot } from './git'
import {
  captureSnapshot,
  conflictPaths,
  diffTurnChanges,
  liveDiff,
  resolveInsideWorkspace,
  restoreTurnChanges,
  snapshotStoreFor,
  turnRef,
} from './snapshot'

const run = promisify(execFile)

const temporaryDirectories: string[] = []

async function fixture(): Promise<{ dshHome: string, worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-turnrewind-snapshot-'))
  temporaryDirectories.push(root)
  const dshHome = join(root, 'home')
  const worktree = join(root, 'project')
  await mkdir(dshHome, { recursive: true })
  await mkdir(worktree, { recursive: true })
  await run('git', ['-c', 'init.defaultBranch=main', 'init', '--quiet', worktree], { windowsHide: true })
  await writeFile(join(worktree, 'a.txt'), 'one\ntwo\n', 'utf8')
  await writeFile(join(worktree, 'gone.txt'), 'bye\n', 'utf8')
  await writeFile(join(worktree, '.gitignore'), 'ignored.txt\n', 'utf8')
  await writeFile(join(worktree, 'ignored.txt'), 'never tracked\n', 'utf8')
  return { dshHome, worktree }
}

async function gitStatus(worktree: string): Promise<string> {
  const { stdout } = await run('git', ['-C', worktree, 'status', '--porcelain=v1'], { windowsHide: true })
  return stdout
}

async function gitHead(worktree: string): Promise<string> {
  const [head, branch, refs] = await Promise.all([
    run('git', ['-C', worktree, 'rev-parse', 'HEAD'], { windowsHide: true }).catch(() => ({ stdout: '' })),
    run('git', ['-C', worktree, 'symbolic-ref', '--quiet', 'HEAD'], { windowsHide: true }).catch(() => ({ stdout: '' })),
    run('git', ['-C', worktree, 'for-each-ref', '--format=%(refname)'], { windowsHide: true }),
  ])
  return `${head.stdout}|${branch.stdout}|${refs.stdout}`
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('captureSnapshot + diffTurnChanges', () => {
  it('reports added / modified / deleted files with per-file line counts', async () => {
    const { dshHome, worktree } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)

    const before = await captureSnapshot(store, turnRef('s1', 1, 'before'), 'turn 1 before')
    expect(before.ok).toBe(true)

    await writeFile(join(worktree, 'a.txt'), 'one\ntwo\nthree\n', 'utf8')
    await writeFile(join(worktree, 'new.txt'), 'fresh\n', 'utf8')
    await rm(join(worktree, 'gone.txt'))

    const after = await captureSnapshot(store, turnRef('s1', 1, 'after'), 'turn 1 after')
    expect(after.ok).toBe(true)
    if (!before.ok || !after.ok)
      return

    const diff = await diffTurnChanges(store, before.commit, after.commit)
    expect(diff.ok).toBe(true)
    if (!diff.ok)
      return
    const byPath = new Map(diff.changes.map(change => [change.path, change]))
    expect(byPath.get('a.txt')).toMatchObject({ status: 'M', insertions: 1, deletions: 0, binary: false })
    expect(byPath.get('new.txt')).toMatchObject({ status: 'A', insertions: 1, deletions: 0 })
    expect(byPath.get('gone.txt')).toMatchObject({ status: 'D' })
    // 被 .gitignore 排除的文件由源仓库 ignore 规则决定，不进入快照。
    expect(byPath.has('ignored.txt')).toBe(false)
  })

  it('marks binary differences instead of counting lines', async () => {
    const { dshHome, worktree } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)
    const before = await captureSnapshot(store, turnRef('s2', 1, 'before'), 'before')
    expect(before.ok).toBe(true)
    await writeFile(join(worktree, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
    const after = await captureSnapshot(store, turnRef('s2', 1, 'after'), 'after')
    expect(after.ok).toBe(true)
    if (!before.ok || !after.ok)
      return
    const diff = await diffTurnChanges(store, before.commit, after.commit)
    expect(diff.ok).toBe(true)
    if (!diff.ok)
      return
    expect(diff.changes.find(change => change.path === 'blob.bin')).toMatchObject({ binary: true, insertions: null, deletions: null })
  })

  it('keeps the user repository untouched (HEAD / branch / refs / status)', async () => {
    const { dshHome, worktree } = await fixture()
    const beforeState = await gitHead(worktree)
    const beforeStatus = await gitStatus(worktree)
    const store = snapshotStoreFor(dshHome, worktree)
    await captureSnapshot(store, turnRef('s3', 1, 'before'), 'before')
    await writeFile(join(worktree, 'a.txt'), 'changed\n', 'utf8')
    await captureSnapshot(store, turnRef('s3', 1, 'after'), 'after')
    expect(await gitHead(worktree)).toBe(beforeState)
    expect(await gitStatus(worktree)).toBe(beforeStatus)
  })
})

describe('conflictPaths', () => {
  it('flags files changed after the turn and clears untouched ones', async () => {
    const { dshHome, worktree } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)
    const before = await captureSnapshot(store, turnRef('s4', 1, 'before'), 'before')
    await writeFile(join(worktree, 'a.txt'), 'one\ntwo\nthree\n', 'utf8')
    await writeFile(join(worktree, 'made.txt'), 'made\n', 'utf8')
    const after = await captureSnapshot(store, turnRef('s4', 1, 'after'), 'after')
    expect(before.ok && after.ok).toBe(true)
    if (!before.ok || !after.ok)
      return
    const diff = await diffTurnChanges(store, before.commit, after.commit)
    expect(diff.ok).toBe(true)
    if (!diff.ok)
      return

    const clean = await conflictPaths(store, after.commit, diff.changes)
    expect(clean).toEqual({ ok: true, paths: [] })

    await writeFile(join(worktree, 'a.txt'), 'user edited again\n', 'utf8')
    const conflicted = await conflictPaths(store, after.commit, diff.changes)
    expect(conflicted.ok).toBe(true)
    if (conflicted.ok)
      expect(conflicted.paths).toEqual(['a.txt'])
  })

  it('flags a recreated file the turn had deleted (git diff alone cannot see it)', async () => {
    const { dshHome, worktree } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)
    const before = await captureSnapshot(store, turnRef('s5', 1, 'before'), 'before')
    await rm(join(worktree, 'gone.txt'))
    const after = await captureSnapshot(store, turnRef('s5', 1, 'after'), 'after')
    expect(before.ok && after.ok).toBe(true)
    if (!before.ok || !after.ok)
      return
    const diff = await diffTurnChanges(store, before.commit, after.commit)
    expect(diff.ok).toBe(true)
    if (!diff.ok)
      return
    await writeFile(join(worktree, 'gone.txt'), 'user recreated it\n', 'utf8')
    const conflicted = await conflictPaths(store, after.commit, diff.changes)
    expect(conflicted.ok).toBe(true)
    if (conflicted.ok)
      expect(conflicted.paths).toContain('gone.txt')
  })
})

describe('restoreTurnChanges', () => {
  it('restores modified and deleted files and removes files the turn created', async () => {
    const { dshHome, worktree } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)
    const before = await captureSnapshot(store, turnRef('s6', 1, 'before'), 'before')
    await writeFile(join(worktree, 'a.txt'), 'one\ntwo\nthree\n', 'utf8')
    await rm(join(worktree, 'gone.txt'))
    await mkdir(join(worktree, 'fresh', 'deep'), { recursive: true })
    await writeFile(join(worktree, 'fresh', 'deep', 'new.txt'), 'new\n', 'utf8')
    const after = await captureSnapshot(store, turnRef('s6', 1, 'after'), 'after')
    expect(before.ok && after.ok).toBe(true)
    if (!before.ok || !after.ok)
      return
    const diff = await diffTurnChanges(store, before.commit, after.commit)
    expect(diff.ok).toBe(true)
    if (!diff.ok)
      return

    const report = await restoreTurnChanges(store, before.commit, diff.changes)
    expect(report.failed).toEqual([])
    // 换行由 git 的 filter 决定（私有仓镜像源仓库/全局 core.autocrlf），
    // 断言时先归一：真正要钉的是「内容回到 before」，不是某一种换行字节。
    const restored = await readFile(join(worktree, 'a.txt'), 'utf8')
    expect(restored.replace(/\r\n/g, '\n')).toBe('one\ntwo\n')
    expect((await readFile(join(worktree, 'gone.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('bye\n')
    expect(existsSync(join(worktree, 'fresh', 'deep', 'new.txt'))).toBe(false)
    // 只清理变空的父目录，工作区根本身保留。
    expect(existsSync(join(worktree, 'fresh', 'deep'))).toBe(false)
    expect(existsSync(worktree)).toBe(true)

    // 恢复后的工作区必须与 before 快照**逐字节等价**（同一 git 树）：
    // 这条同时钉住换行/属性的往返对称性——若私有仓的 core.autocrlf 与源仓库
    // 不一致，恢复出来的树就会与 before 树不同，此断言立刻失败。
    const recheck = await captureSnapshot(store, turnRef('s6-recheck', 1, 'before'), 'recheck')
    expect(recheck.ok).toBe(true)
    if (recheck.ok && before.ok) {
      const [beforeTree, recheckTree] = await Promise.all([
        gitInSnapshot(store, ['rev-parse', `${before.commit}^{tree}`]),
        gitInSnapshot(store, ['rev-parse', `${recheck.commit}^{tree}`]),
      ])
      expect(beforeTree.ok && recheckTree.ok).toBe(true)
      if (beforeTree.ok && recheckTree.ok)
        expect(recheckTree.out.trim()).toBe(beforeTree.out.trim())
    }
  })
})

describe('liveDiff（运行中实时读数）', () => {
  it('counts the workspace against the before snapshot, including brand-new files', async () => {
    const { dshHome, worktree } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)
    const before = await captureSnapshot(store, turnRef('s7', 1, 'before'), 'before')
    expect(before.ok).toBe(true)
    if (!before.ok)
      return

    // turn 刚起步：还没有任何改动。
    expect(await liveDiff(store, before.commit)).toEqual({ ok: true, stats: { fileCount: 0, insertions: 0, deletions: 0 } })

    await writeFile(join(worktree, 'a.txt'), 'one\ntwo\nthree\n', 'utf8')
    await writeFile(join(worktree, 'added.txt'), 'new\n', 'utf8')
    await rm(join(worktree, 'gone.txt'))

    const live = await liveDiff(store, before.commit)
    expect(live.ok).toBe(true)
    if (!live.ok)
      return
    // 修改 + 新建 + 删除各算一个文件；新建文件靠「先刷新私有 index」才可见。
    expect(live.stats).toEqual({ fileCount: 3, insertions: 2, deletions: 1 })

    // 实时读数只是「提前看」：结束后的 after 差异必须给出同一组文件。
    const after = await captureSnapshot(store, turnRef('s7', 1, 'after'), 'after')
    expect(after.ok).toBe(true)
    if (!after.ok)
      return
    const diff = await diffTurnChanges(store, before.commit, after.commit)
    expect(diff.ok).toBe(true)
    if (!diff.ok)
      return
    expect(diff.changes).toHaveLength(live.stats.fileCount)
  })

  it('reports git failures instead of throwing when the snapshot store is gone', async () => {
    const { dshHome, worktree } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)
    const before = await captureSnapshot(store, turnRef('s8', 1, 'before'), 'before')
    expect(before.ok).toBe(true)
    if (!before.ok)
      return
    await rm(store.gitDir, { recursive: true, force: true })
    const live = await liveDiff(store, before.commit)
    expect(live.ok).toBe(false)
  })
})

describe('resolveInsideWorkspace', () => {
  it('accepts nested paths and rejects escapes', async () => {
    const { worktree } = await fixture()
    expect(resolveInsideWorkspace(worktree, 'src/a.ts')).not.toBeNull()
    expect(resolveInsideWorkspace(worktree, '../outside.txt')).toBeNull()
    expect(resolveInsideWorkspace(worktree, 'a/../../outside.txt')).toBeNull()
    expect(resolveInsideWorkspace(worktree, 'C:\\Other\\file.txt')).toBeNull()
    expect(resolveInsideWorkspace(worktree, '')).toBeNull()
  })
})
