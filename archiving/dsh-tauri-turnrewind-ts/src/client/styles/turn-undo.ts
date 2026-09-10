/**
 * client/styles/turn-undo.ts — turn 尾部「撤销本轮」按钮样式（css-render 树）。
 *
 * 与卡片/dialog 的类名零重叠；颜色走主题 token，尺寸一律带单位（css-render
 * 不会给裸数字补 px）。
 */

import { CssRender } from 'dsh-tauri/client'
import { TURNREWIND_CLASS_PREFIX, TURNREWIND_STYLE_ID } from '../constants'

const P = TURNREWIND_CLASS_PREFIX

/** 构建 turn 尾部按钮样式节点（独立导出供测试渲染断言）。 */
export function buildTurnUndoStyleNodes(cssr: ReturnType<typeof CssRender>) {
  return cssr.c([
    cssr.c(`.${P}-turn-undo-row`, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '6px',
    }),
    cssr.c(`.${P}-turn-undo`, {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      fontSize: '12px',
      lineHeight: '18px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-tertiary, #8b8b8b)',
      border: '1px solid var(--dsw-alias-border-l2, #e5e5e5)',
      borderRadius: '6px',
      cursor: 'pointer',
    }),
    cssr.c(`.${P}-turn-undo:hover`, {
      color: 'var(--dsw-alias-label-primary, #111111)',
      borderColor: 'var(--dsw-alias-border-l1, #cccccc)',
    }),
    cssr.c(`.${P}-turn-undo:disabled`, {
      opacity: 0.6,
      cursor: 'default',
    }),
    cssr.c(`.${P}-turn-undo-error`, {
      fontSize: '12px',
      color: 'var(--dsw-alias-state-error-primary, #d03050)',
    }),
  ])
}

/** 挂载 turn 尾部按钮样式（latest-wins，见 styles/index.ts 文件头）。 */
export function mountTurnUndoStyles(): () => void {
  const styleId = `${TURNREWIND_STYLE_ID}-turn-undo`
  if (typeof document === 'undefined')
    return () => {}
  document.getElementById(styleId)?.remove()
  const style = buildTurnUndoStyleNodes(CssRender())
  style.mount({ id: styleId, head: true })
  return () => style.unmount({ id: styleId })
}
