import type { ReactElement } from 'react'
import type { TurnChangesCardProps } from '../types'
import { ArrowRotateLeft, ArrowUpRight, ChevronDown, ChevronUp, Icon, SquarePlus, useMountStyle } from 'dsh-tauri-ui/client'
/**
 * turn-changes-card.tsx — 一轮结束时渲染的变更卡片（视觉对齐官方 deliverables 行）。
 *
 * 职责拆分：槽位注册在 register/turn-tail.ts，数据在 store/，样式在 .cssr.ts，
 * 纯函数判定与格式化在 utils/format.ts（本文件只做组合与交互）。
 *
 * 交互边界（需求明确）：只有「撤销」是真功能；`📝 文件`（图标块）、
 * 「查看更改」（单文件卡片 hover 出现）、「审核」三者一律为占位
 * （无点击处理，用 data-placeholder 标明，便于测试钉住）。
 * 「再显示 N 个文件」是真实功能（展开/收起）。
 *
 * 单文件与多文件的差异：单文件时标题就是文件名、不渲染清单，
 * hover 时副行的计数换成「查看更改 ↗」；多文件时标题是文件数、
 * 副行固定显示总计数，清单最多三行。
 */
import { useEffect, useState } from 'react'
import {
  TURNREWIND_CARD_STYLE_ID,
  TURNREWIND_COUNTS_STYLE_ID,
  TURNREWIND_SUMMARY_MAX_RETRIES,
  TURNREWIND_SUMMARY_RETRY_DELAY_MS,
  TURNREWIND_VISIBLE_FILE_ROWS,
} from '../constants'
import { text, useLocale } from '../locales'
import { ensureSummary, requestUndo, retrySummaryForTurn, useTurnrewindSession } from '../store'
import countsStyle from '../styles/counts.cssr'
import { cardTitle, fileListWindow, formatCounts, formatTotals, resolveCardState } from '../utils/format'
import { ChangeCounts } from './change-counts'
import { GitRequiredDialog } from './git-required-dialog'
import cardStyle from './turn-changes-card.cssr'

export function TurnChangesCard(props: TurnChangesCardProps): ReactElement | null {
  useMountStyle(cardStyle, TURNREWIND_CARD_STYLE_ID)
  useMountStyle(countsStyle, TURNREWIND_COUNTS_STYLE_ID)
  useLocale()
  const sessionId = props.sessionId
  const turn = props.matched?.turn ?? props.turn?.turn
  const state = useTurnrewindSession(sessionId)
  // 展开态按 turn 记账，而不是「effect 里复位布尔量」：卡片会被复用渲染下一轮，
  // 用 turn 作为天然的复位键（也避开 set-state-in-effect 的多余渲染）。
  const [expandedTurn, setExpandedTurn] = useState<number | undefined>(undefined)
  const expanded = expandedTurn !== undefined && expandedTurn === turn
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    void ensureSummary(sessionId)
  }, [sessionId])

  const card = resolveCardState(state.summary, turn)
  const attempts = turn === undefined ? 0 : (state.attempts[turn] ?? 0)
  // after 快照在 turn/end 之后后台结算：本轮已结束但账本暂无记录时做有限重试。
  const waiting = card.kind === 'hidden'
    && state.status === 'ready'
    && state.summary !== null
    && state.summary.isGit
    && sessionId !== undefined
    && turn !== undefined
    && attempts < TURNREWIND_SUMMARY_MAX_RETRIES

  useEffect(() => {
    if (!waiting || sessionId === undefined || turn === undefined)
      return
    const timer = setTimeout(() => {
      void retrySummaryForTurn(sessionId, turn)
    }, TURNREWIND_SUMMARY_RETRY_DELAY_MS)
    return () => clearTimeout(timer)
  }, [waiting, sessionId, turn, attempts])

  if (card.kind === 'hidden')
    return null

  const record = card.kind === 'ready' || card.kind === 'undone' ? card.record : null
  const files = record?.files ?? []
  // 单文件：标题即文件名、不渲染清单，副行 hover 可换成「查看更改」。
  const single = record !== null && files.length === 1
  // 清单窗口：hiddenCount 恒按折叠态计算，展开后按钮仍在（否则无法收起）。
  const window = files.length > 1
    ? fileListWindow(files, expanded, TURNREWIND_VISIBLE_FILE_ROWS)
    : { visible: [], hiddenCount: 0 }
  const undone = card.kind === 'undone'
  const blocked = card.kind === 'failed' || card.kind === 'unavailable'
  const gitRequired = card.kind === 'git-required'

  const title = record !== null
    ? cardTitle(record, name => text('editedOne', { name }), count => text('editedMany', { count }))
    : text('unavailableTitle')

  // 打开文件：owner 份额里框架自带 openFile（相对路径按会话 cwd 解析）。
  // 临时逻辑（需求方要求）：单文件卡片的文件名与多文件清单的每一行都可点击打开，
  // 内核若未派发 openFile 则退化为不可点击（不报错、不白屏）。
  const openFile = typeof props.openFile === 'function' ? props.openFile : undefined
  const singlePath = single ? files[0]?.path : undefined

  const onUndo = (): void => {
    if (gitRequired) {
      setDialogOpen(true)
      return
    }
    if (blocked || state.undoing || turn === undefined)
      return
    void requestUndo(sessionId, turn)
  }

  return (
    <div className="dshp-turnrewind">
      <div
        className={`dshp-turnrewind__card${single ? ' dshp-turnrewind__card--single' : ''}`}
        data-turnrewind-card={String(turn ?? '')}
      >
        <div className="dshp-turnrewind__head">
          {/* 占位：📝 文件图标块不做任何事（需求：文件按钮仅做占位）。 */}
          <span className="dshp-turnrewind__icon" title={text('fileButton')} aria-label={text('fileButton')} data-placeholder="file">
            <Icon as={SquarePlus} size={18} />
          </span>
          <div className="dshp-turnrewind__meta">
            {/* 单文件：文件名本身就是打开入口（openFile 缺席时退回纯文本，不报错）。 */}
            {single && singlePath !== undefined && openFile !== undefined
              ? (
                  <button
                    type="button"
                    className="dshp-turnrewind__title dshp-turnrewind__title--link"
                    onClick={() => openFile(singlePath)}
                    title={singlePath}
                  >
                    {title}
                  </button>
                )
              : <span className="dshp-turnrewind__title" title={title}>{title}</span>}
            <span className="dshp-turnrewind__sub">
              {record !== null
                ? (
                    <>
                      <span className="dshp-turnrewind__counts" title={formatTotals(record)}>
                        <ChangeCounts
                          insertions={record.insertions}
                          deletions={record.deletions}
                          binary={false}
                          binaryLabel={text('binary')}
                        />
                      </span>
                      {/* 占位：hover 出现「查看更改」，点击无动作（已撤销后同样保留 hover 效果）。 */}
                      {single && (
                        <span className="dshp-turnrewind__hint" data-placeholder="view-changes">
                          {text('viewChanges')}
                          <Icon as={ArrowUpRight} size={14} />
                        </span>
                      )}
                    </>
                  )
                : (
                    <span className="dshp-turnrewind__hint-text">
                      {gitRequired
                        ? text('unavailableGitDesc')
                        : text('unavailableReason', { reason: card.kind === 'failed' || card.kind === 'unavailable' ? (card.reason ?? '') : '' })}
                    </span>
                  )}
            </span>
          </div>
          <span className="dshp-turnrewind__spacer" />
          {/* 已撤销：只留「已撤销」徽标，撤销按钮不再出现（避免看起来还能再撤一次）。 */}
          {undone
            ? <span className="dshp-turnrewind__badge">{text('undoneBadge')}</span>
            : (
                <button
                  type="button"
                  className="dshp-turnrewind__undo"
                  disabled={blocked || state.undoing}
                  onClick={onUndo}
                  title={text('undo')}
                >
                  {state.undoing ? text('undoing') : text('undo')}
                  <Icon as={ArrowRotateLeft} size={12} />
                </button>
              )}
          {/*
            TODO(review-action): 「审核」占位按钮暂时整体隐藏（需求方要求），
            重新启用时注意：已撤销的 turn 不应再显示它（那时已无变更可审）。
            <button type="button" className="dshp-turnrewind__review" data-placeholder="review" title={text('review')}>
              {text('review')}
            </button>
          */}
        </div>

        {window.visible.length > 0 && (
          <div className="dshp-turnrewind__files">
            {window.visible.map((file) => {
              const rowClassName = `dshp-turnrewind__file${file.status === 'D' ? ' dshp-turnrewind__file--deleted' : ''}`
              const rowTitle = `${file.path}  ${formatCounts(file, text('binary'))}`
              const rowBody = (
                <>
                  <span className="dshp-turnrewind__file-path">{file.path}</span>
                  <span className="dshp-turnrewind__file-counts">
                    <ChangeCounts
                      insertions={file.insertions}
                      deletions={file.deletions}
                      binary={file.binary}
                      binaryLabel={text('binary')}
                    />
                  </span>
                </>
              )
              // 临时逻辑：清单行可点击打开文件（owner 份额的 openFile，相对路径按会话 cwd 解析）。
              return openFile === undefined
                ? (
                    <div key={file.path} className={rowClassName} data-status={file.status} title={rowTitle}>
                      {rowBody}
                    </div>
                  )
                : (
                    <button
                      key={file.path}
                      type="button"
                      className={rowClassName}
                      data-status={file.status}
                      title={rowTitle}
                      onClick={() => openFile(file.path)}
                    >
                      {rowBody}
                    </button>
                  )
            })}
          </div>
        )}

        {/* 折叠控件始终存在（展开后是「收起文件」），否则展开就没有回头路。 */}
        {window.hiddenCount > 0 && (
          <button type="button" className="dshp-turnrewind__more" onClick={() => setExpandedTurn(current => (current === turn ? undefined : turn))}>
            {expanded ? text('collapseFiles') : text('moreFiles', { count: window.hiddenCount })}
            <Icon as={expanded ? ChevronUp : ChevronDown} size={14} />
          </button>
        )}

        {state.undoError !== null && (
          <div className="dshp-turnrewind__notice dshp-turnrewind__notice--error">
            <div>{text('undoFailed', { reason: state.undoError })}</div>
            {state.undoConflicts.length > 0 && (
              <>
                <div>{text('conflictTitle')}</div>
                <ul className="dshp-turnrewind__conflict-list">
                  {state.undoConflicts.map(conflict => (
                    <li key={conflict.path} className="dshp-turnrewind__conflict-item" title={conflict.path}>{conflict.path}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      <GitRequiredDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
