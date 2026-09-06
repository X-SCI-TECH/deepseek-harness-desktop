import { cssr, styles as sharedStyles } from 'dsh-tauri-ui/client'

const { c } = cssr
const { primary, secondary, tertiary, borderL2: border, layer1, hover } = sharedStyles

/** MCP 列表（mcp-tab.tsx）：格式分段 + 标签 chips + 开关 + 链接。 */
export default c([
  c('.dshp-extension__segments', {
    display: 'inline-flex',
    gap: '4px',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    padding: '3px',
    background: layer1,
  }),
  c('.dshp-extension__segment', {
    border: '0',
    borderRadius: '6px',
    padding: '4px 14px',
    background: 'transparent',
    color: secondary,
    font: 'inherit',
    fontSize: '12px',
    cursor: 'pointer',
  }, [
    c('&[data-active="true"]', { background: hover, color: primary, fontWeight: '600' }),
  ]),
  c('.dshp-extension__format', {
    border: `1px solid ${border}`,
    borderRadius: '8px',
    padding: '8px 12px',
    background: layer1,
  }, [
    c('& summary', { fontSize: '12px', color: secondary, cursor: 'pointer' }),
  ]),
  c('.dshp-extension__format-hint', { margin: '2px 0 0', fontSize: '12px', color: tertiary }),
])
