/**
 * client/styles/turn-undo.ts — 助手动作条「撤销本轮」按钮样式（css-render 树）。
 *
 * 按钮住在核心的消息动作条里（copy/branch/点赞同排），所以尺寸与观感对齐那一行
 * 的既有图标按钮：28px 高、圆角、hover 用交互底色；颜色走主题 token，尺寸一律
 * 带单位（css-render 不给裸数字补 px）。
 */

import { CssRender } from 'dsh-tauri/client'
import { TURNREWIND_CLASS_PREFIX, TURNREWIND_STYLE_ID } from '../constants'

const P = TURNREWIND_CLASS_PREFIX

/** 构建动作条按钮样式节点（独立导出供测试渲染断言）。 */
export function buildTurnUndoStyleNodes(cssr: ReturnType<typeof CssRender>) {
  return cssr.c([
    cssr.c(`.${P}-turn-undo-row`, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
    }),
    cssr.c(`.${P}-turn-undo`, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      height: '28px',
      padding: '0 10px',
      fontSize: '13px',
      lineHeight: '28px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-tertiary, #8b8b8b)',
      border: 'none',
      borderRadius: '14px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }),
    cssr.c(`.${P}-turn-undo:hover:not(:disabled)`, {
      background: 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12))',
      color: 'var(--dsw-alias-label-secondary, #4b4b4b)',
    }),
    cssr.c(`.${P}-turn-undo:disabled`, {
      cursor: 'default',
      opacity: 0.5,
    }),
    cssr.c(`.${P}-turn-undo-icon`, {
      flex: 'none',
    }),
    cssr.c(`.${P}-turn-undo-text`, {
      flex: 'none',
    }),
    cssr.c(`.${P}-turn-undo-error`, {
      fontSize: '12px',
      color: 'var(--dsw-alias-state-error-primary, #d03050)',
    }),
  ])
}

/** 挂载动作条按钮样式（latest-wins，见 styles/index.ts 文件头）。 */
export function mountTurnUndoStyles(): () => void {
  const styleId = `${TURNREWIND_STYLE_ID}-turn-undo`
  if (typeof document === 'undefined')
    return () => {}
  document.getElementById(styleId)?.remove()
  const style = buildTurnUndoStyleNodes(CssRender())
  style.mount({ id: styleId, head: true })
  return () => style.unmount({ id: styleId })
}
