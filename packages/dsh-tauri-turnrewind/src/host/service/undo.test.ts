import type { TurnRecord } from '../types'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { join } from 'pathe'
import { afterEach, describe, expect, it } from 'vitest'
import { REASON_ALREADY_UNDONE, REASON_CONFLICT, REASON_GIT_REQUIRED, REASON_SNAPSHOT_FAILED } from '../constants'
import { recordTurn, recordWorkspaceState } from './ledger'
import { captureSnapshot, diffTurnChanges, snapshotStoreFor, turnRef } from './snapshot'
import { undoTurn } from './undo'

const run = promisify(execFile)

const temporaryDirectories: string[] = []

interface Fixture {
  dshHome: string
  worktree: string
  sessionId: string
  turn: number
  record: TurnRecord
}

/**
 * 造一个「一轮改了一个文件」的真实场景：before 快照 → 改文件 → after 快照 →
 * 差异算好写进账本，等价于 capture.ts 在真实 turn 里做的事。
 */
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-turnrewind-undo-'))
  temporaryDirectories.push(root)
  const dshHome = join(root, 'home')
  const worktree = join(root, 'project')
  await mkdir(dshHome, { recursive: true })
  await mkdir(worktree, { recursive: true })
  await run('git', ['-c', 'init.defaultBranch=main', 'init', '--quiet', worktree], { windowsHide: true })
  await writeFile(join(worktree, 'a.txt'), 'first\n', 'utf8')

  const sessionId = 'session-undo'
  const turn = 1
  const store = snapshotStoreFor(dshHome, worktree)
  const before = await captureSnapshot(store, turnRef(sessionId, turn, 'before'), 'before')
  await writeFile(join(worktree, 'a.txt'), 'first\nsecond\n', 'utf8')
  await writeFile(join(worktree, 'added.txt'), 'new\n', 'utf8')
  const after = await captureSnapshot(store, turnRef(sessionId, turn, 'after'), 'after')
  if (!before.ok || !after.ok)
    throw new Error('fixture capture failed')
  const diff = await diffTurnChanges(store, before.commit, after.commit)
  if (!diff.ok)
    throw new Error('fixture diff failed')

  let insertions = 0
  let deletions = 0
  for (const change of diff.changes) {
    insertions += change.insertions ?? 0
    deletions += change.deletions ?? 0
  }
  const record: TurnRecord = {
    turn,
    beforeRef: turnRef(sessionId, turn, 'before'),
    afterRef: turnRef(sessionId, turn, 'after'),
    files: diff.changes,
    insertions,
    deletions,
    createdAt: Date.now(),
    undoneAt: null,
    unavailable: null,
  }
  await recordWorkspaceState(dshHome, sessionId, { workspaceRoot: store.worktree, isGit: true, unavailableReason: null })
  await recordTurn(dshHome, sessionId, record)
  return { dshHome, worktree, sessionId, turn, record }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('undoTurn', () => {
  it('restores the workspace and marks the turn undone', async () => {
    const { dshHome, worktree, sessionId, turn } = await fixture()
    const outcome = await undoTurn({ dshHome, sessionId, turn, currentWorkspace: worktree })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok)
      return
    expect(outcome.failed).toEqual([])
    expect(outcome.restored).toContain('a.txt')
    expect(outcome.removed).toContain('added.txt')
    expect((await readFile(join(worktree, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('first\n')
    expect(existsSync(join(worktree, 'added.txt'))).toBe(false)
  })

  it('refuses with the conflict list and changes nothing when the file changed again', async () => {
    const { dshHome, worktree, sessionId, turn } = await fixture()
    await writeFile(join(worktree, 'a.txt'), 'user edit after the turn\n', 'utf8')
    const outcome = await undoTurn({ dshHome, sessionId, turn, currentWorkspace: worktree })
    expect(outcome.ok).toBe(false)
    if (outcome.ok)
      return
    expect(outcome.code).toBe(409)
    expect(outcome.error).toBe(REASON_CONFLICT)
    expect(outcome.conflicts?.map(conflict => conflict.path)).toEqual(['a.txt'])
    // 预检发生在动文件之前：内容与新增文件都保持原样。
    expect(await readFile(join(worktree, 'a.txt'), 'utf8')).toBe('user edit after the turn\n')
    expect(existsSync(join(worktree, 'added.txt'))).toBe(true)
  })

  it('rejects a second undo of the same turn', async () => {
    const { dshHome, worktree, sessionId, turn } = await fixture()
    expect((await undoTurn({ dshHome, sessionId, turn, currentWorkspace: worktree })).ok).toBe(true)
    const second = await undoTurn({ dshHome, sessionId, turn, currentWorkspace: worktree })
    expect(second.ok).toBe(false)
    if (!second.ok)
      expect(second.error).toBe(REASON_ALREADY_UNDONE)
  })

  it('returns 404 for a turn with no record', async () => {
    const { dshHome, worktree, sessionId } = await fixture()
    const outcome = await undoTurn({ dshHome, sessionId, turn: 42, currentWorkspace: worktree })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok)
      expect(outcome.code).toBe(404)
  })

  it('refuses when the session now points at another workspace', async () => {
    const { dshHome, worktree, sessionId, turn } = await fixture()
    const outcome = await undoTurn({ dshHome, sessionId, turn, currentWorkspace: join(worktree, 'other') })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok)
      expect(outcome.code).toBe(403)
  })

  it('reports the Git requirement for a non-repository ledger', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-turnrewind-undo-nogit-'))
    temporaryDirectories.push(home)
    await recordWorkspaceState(home, 'session-nogit', {
      workspaceRoot: null,
      isGit: false,
      unavailableReason: REASON_GIT_REQUIRED,
    })
    await recordTurn(home, 'session-nogit', {
      turn: 1,
      beforeRef: '',
      afterRef: '',
      files: [],
      insertions: 0,
      deletions: 0,
      createdAt: Date.now(),
      undoneAt: null,
      unavailable: null,
    })
    const outcome = await undoTurn({ dshHome: home, sessionId: 'session-nogit', turn: 1, currentWorkspace: null })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok)
      expect(outcome.error).toBe(REASON_GIT_REQUIRED)
  })

  it('reports a dead snapshot instead of throwing when the refs are gone', async () => {
    const { dshHome, worktree, sessionId, turn } = await fixture()
    const store = snapshotStoreFor(dshHome, worktree)
    const { deleteRefs } = await import('./snapshot')
    await deleteRefs(store, [turnRef(sessionId, turn, 'before')])
    const outcome = await undoTurn({ dshHome, sessionId, turn, currentWorkspace: worktree })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe(409)
      expect(outcome.error).toBe(REASON_SNAPSHOT_FAILED)
    }
  })
})
