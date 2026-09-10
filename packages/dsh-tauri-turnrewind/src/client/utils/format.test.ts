import type { SessionSummary, TurnSummary } from '../types'
import { describe, expect, it } from 'vitest'
import { TURNREWIND_VISIBLE_FILE_ROWS } from '../constants'
import {
  basename,
  cardTitle,
  fileListWindow,
  formatCounts,
  formatTotals,
  resolveCardState,
} from './format'

function turnSummary(patch: Partial<TurnSummary> = {}): TurnSummary {
  return {
    turn: 1,
    fileCount: 1,
    insertions: 4,
    deletions: 3,
    undoneAt: null,
    unavailable: null,
    truncated: false,
    files: [{ path: 'src/driver.ts', status: 'M', insertions: 4, deletions: 3, binary: false }],
    ...patch,
  }
}

function summary(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 'session-1',
    isGit: true,
    workspaceRoot: 'C:/proj',
    unavailableReason: null,
    turns: [turnSummary()],
    ...patch,
  }
}

describe('formatCounts / formatTotals', () => {
  it('renders +N -M and falls back to the binary label', () => {
    expect(formatCounts({ insertions: 5, deletions: 3, binary: false }, 'binary')).toBe('+5 -3')
    expect(formatCounts({ insertions: null, deletions: null, binary: true }, 'binary')).toBe('binary')
    expect(formatCounts({ insertions: null, deletions: null, binary: false }, 'binary')).toBe('+0 -0')
  })

  it('renders totals', () => {
    expect(formatTotals({ insertions: 18, deletions: 10 })).toBe('+18 -10')
  })
})

describe('basename', () => {
  it('returns the last path segment as the file name', () => {
    expect(basename('skills/arch-upkeep/SKILL.md')).toBe('SKILL.md')
    expect(basename('a.txt')).toBe('a.txt')
  })
})

describe('resolveCardState', () => {
  it('stays hidden without a usable turn number or summary', () => {
    expect(resolveCardState(null, 1)).toEqual({ kind: 'hidden' })
    expect(resolveCardState(summary(), undefined)).toEqual({ kind: 'hidden' })
    expect(resolveCardState(summary(), 0)).toEqual({ kind: 'hidden' })
  })

  it('asks for a Git repository when the workspace is not one', () => {
    expect(resolveCardState(summary({ isGit: false, unavailableReason: 'TURNREWIND_GIT_REQUIRED' }), 1)).toEqual({ kind: 'git-required' })
    expect(resolveCardState(summary({ isGit: false, unavailableReason: 'TURNREWIND_UNSAFE_WORKSPACE' }), 1))
      .toEqual({ kind: 'unavailable', reason: 'TURNREWIND_UNSAFE_WORKSPACE' })
  })

  it('maps a recorded turn to ready / undone / failed / hidden', () => {
    expect(resolveCardState(summary(), 1)).toEqual({ kind: 'ready', record: turnSummary() })
    expect(resolveCardState(summary({ turns: [turnSummary({ undoneAt: 5 })] }), 1).kind).toBe('undone')
    expect(resolveCardState(summary({ turns: [turnSummary({ unavailable: 'TURNREWIND_TOO_MANY_FILES' })] }), 1))
      .toEqual({ kind: 'failed', reason: 'TURNREWIND_TOO_MANY_FILES' })
    // 记录存在但这一轮没有任何文件变化：不占位。
    expect(resolveCardState(summary({ turns: [turnSummary({ files: [] })] }), 1)).toEqual({ kind: 'hidden' })
    // 账本还没有这一轮的记录（after 快照仍在结算）：不占位，由组件做有限重试。
    expect(resolveCardState(summary(), 7)).toEqual({ kind: 'hidden' })
  })
})

describe('cardTitle', () => {
  it('names a single file and counts multiple files', () => {
    const one = (name: string) => `edited ${name}`
    const many = (count: number) => `edited ${count} files`
    expect(cardTitle({ files: turnSummary().files }, one, many)).toBe('edited driver.ts')
    expect(cardTitle({
      files: [
        { path: 'a.ts', status: 'M', insertions: 1, deletions: 0, binary: false },
        { path: 'b.ts', status: 'M', insertions: 1, deletions: 0, binary: false },
      ],
    }, one, many)).toBe('edited 2 files')
  })
})

describe('fileListWindow', () => {
  const files = Array.from({ length: 5 }, (_, index) => ({
    path: `f${index}.ts`,
    status: 'M' as const,
    insertions: 1,
    deletions: 0,
    binary: false,
  }))

  it('折叠时只显示三行，并给出被隐藏的数量', () => {
    expect(TURNREWIND_VISIBLE_FILE_ROWS).toBe(3)
    const collapsed = fileListWindow(files, false, TURNREWIND_VISIBLE_FILE_ROWS)
    expect(collapsed.visible).toHaveLength(3)
    expect(collapsed.hiddenCount).toBe(2)
  })

  it('展开后显示全部文件，但 hiddenCount 仍按折叠态计算（「收起文件」按钮必须还在）', () => {
    const expanded = fileListWindow(files, true, TURNREWIND_VISIBLE_FILE_ROWS)
    expect(expanded.visible).toHaveLength(5)
    expect(expanded.hiddenCount).toBe(2)
    // 收起后回到三行。
    expect(fileListWindow(files, false, TURNREWIND_VISIBLE_FILE_ROWS).visible).toHaveLength(3)
  })

  it('不超过三行时没有折叠控件', () => {
    const small = fileListWindow(files.slice(0, 3), false, TURNREWIND_VISIBLE_FILE_ROWS)
    expect(small.visible).toHaveLength(3)
    expect(small.hiddenCount).toBe(0)
  })
})
