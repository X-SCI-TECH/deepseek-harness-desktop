import { cssr } from 'dsh-tauri-ui/client'

const { bem: { b, e, m } } = cssr

/**
 * 「撤销需要使用 Git 代码仓库」说明弹窗（git-required-dialog.tsx）。
 *
 * 弹窗由卡片内联渲染（`position: fixed` 覆盖层）：turnTail 卡片位于对话流内，
 * 内联 fixed 层足以盖住整窗，无需再注册一个 shell.overlay 槽位（少一处
 * 「槽位未声明则永久等待」的失败面）。
 */
export default b('turnrewind-dialog', {
  position: 'fixed',
  inset: '0',
  zIndex: '2000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: 'rgba(0, 0, 0, 0.32)',
}, [
  e('panel', {
    boxSizing: 'border-box',
    width: 'min(420px, 100%)',
    padding: '16px',
    borderRadius: '14px',
    border: '1px solid var(--dsw-alias-border-weak, rgba(127,127,127,0.25))',
    background: 'var(--dsw-alias-bg-base, #fff)',
    color: 'var(--dsw-alias-label-primary)',
    boxShadow: 'var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,0.18))',
  }),
  e('title', {
    margin: '0 0 6px',
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '20px',
  }),
  e('desc', {
    margin: '0 0 14px',
    fontSize: '13px',
    lineHeight: '20px',
    color: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))',
  }),
  e('actions', {
    display: 'flex',
    justifyContent: 'flex-end',
  }),
  e('close', {
    height: '30px',
    padding: '0 14px',
    border: 'none',
    borderRadius: '8px',
    fontFamily: 'inherit',
    fontSize: '13px',
    cursor: 'pointer',
    color: 'var(--dsw-alias-label-primary)',
    background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1))',
  }, [
    m('primary', {
      color: '#fff',
      background: 'var(--dsw-alias-bg-accent, #2f6feb)',
    }),
  ]),
])
