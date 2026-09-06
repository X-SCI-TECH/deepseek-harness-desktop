import { cssr, styles as sharedStyles } from 'dsh-tauri-ui/client'

const { c } = cssr
const { secondary, tertiary } = sharedStyles

/** MCP 批量导入弹窗（mcp-import-dialog.tsx）：分组滚动列表。 */
export default c([
  // Modal className 需高于官方 Modal 内部宽度的特异性，保持双重类。
  c('.dshp-extension__modal-wide.dshp-extension__modal-wide', { width: 'min(680px,100%)' }),
  c('.dshp-extension__modal-form.dshp-extension__modal-form', { width: 'min(760px,100%)' }),
  c('.dshp-extension__modal-scroll.dshp-extension__modal-scroll', { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }),
  c('.dshp-extension__import-scroll', {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    maxHeight: 'min(400px,52vh)',
    overflowY: 'auto',
    padding: '2px 4px 2px 2px',
  }),
  c('.dshp-extension__import-group', { display: 'flex', flexDirection: 'column', gap: '8px' }),
  c('.dshp-extension__import-head', { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 2px' }),
  c('.dshp-extension__import-count', { fontSize: '12px', lineHeight: '18px', color: tertiary }),
  c('.dshp-extension__import-all', {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: secondary,
    cursor: 'pointer',
  }),
])
