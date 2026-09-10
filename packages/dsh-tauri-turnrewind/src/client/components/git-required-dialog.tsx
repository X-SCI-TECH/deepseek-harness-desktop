import type { ReactElement } from 'react'
import { useMountStyle } from 'dsh-tauri-ui/client'
import { useEffect, useRef } from 'react'
import { TURNREWIND_DIALOG_STYLE_ID } from '../constants'
import { text, useLocale } from '../locales'
import dialogStyle from './git-required-dialog.cssr'

/** 弹窗 props（由卡片持有开关状态）。 */
export interface GitRequiredDialogProps {
  open: boolean
  onClose: () => void
}

const TITLE_ID = 'dshp-turnrewind-git-required-title'
const DESC_ID = 'dshp-turnrewind-git-required-desc'

/**
 * 「撤销需要使用 Git 代码仓库」说明弹窗。
 *
 * 文案逐字取自需求：
 *   title: 撤销需要使用 Git 代码仓库
 *   desc : 此操作仅在 Git 代码仓库中运行时有效。
 *   button: 关闭
 * Esc 与遮罩点击同样关闭；打开时把焦点移到关闭按钮（键盘可达）。
 */
export function GitRequiredDialog({ open, onClose }: GitRequiredDialogProps): ReactElement | null {
  useMountStyle(dialogStyle, TURNREWIND_DIALOG_STYLE_ID)
  useLocale()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open)
      return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape')
        onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open)
    return null

  return (
    <div
      className="dshp-turnrewind-dialog"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget)
          onClose()
      }}
    >
      <div
        className="dshp-turnrewind-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESC_ID}
      >
        <h2 id={TITLE_ID} className="dshp-turnrewind-dialog__title">{text('gitRequiredTitle')}</h2>
        <p id={DESC_ID} className="dshp-turnrewind-dialog__desc">{text('gitRequiredDesc')}</p>
        <div className="dshp-turnrewind-dialog__actions">
          <button
            ref={closeRef}
            type="button"
            className="dshp-turnrewind-dialog__close dshp-turnrewind-dialog__close--primary"
            onClick={onClose}
          >
            {text('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
