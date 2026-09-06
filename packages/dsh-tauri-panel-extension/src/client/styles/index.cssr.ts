import { cssr, styles as sharedStyles } from 'dsh-tauri-ui/client'

const { c } = cssr
const { primary, secondary, tertiary, borderL2: border, business, layer1, layer3, hover } = sharedStyles

/** 跨组件通用：卡片列表 / 标签 / 空态文案 / 代码块（技能与 MCP 页共享）。 */
export default c([
  c('.dshp-extension__intro', { margin: '0', fontSize: '13px', lineHeight: '20px', color: tertiary }),
  c('.dshp-extension__empty', { margin: '0', fontSize: '13px', lineHeight: '20px', color: tertiary }),
  c('.dshp-extension__spacer', { flex: '1' }),
  c('.dshp-extension__search', {
    width: '200px',
    boxSizing: 'border-box',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    padding: '4px 10px',
    outline: 'none',
    background: layer1,
    color: primary,
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '18px',
  }, [
    c('&:focus-visible', {
      borderColor: business,
      boxShadow: `0 0 0 2px color-mix(in srgb,${business} 18%,transparent)`,
    }),
  ]),
  c('.dshp-extension__cards', {
    display: 'grid',
    gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
    alignItems: 'stretch',
    gap: '10px',
    margin: '0',
    padding: '0',
    listStyle: 'none',
  }),
  c('.dshp-extension__cards.dshp-extension__cards--single', { gridTemplateColumns: 'minmax(0,1fr)' }),
  c('.dshp-extension__card', {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: '0',
    border: `1px solid ${border}`,
    borderRadius: '10px',
    background: layer3,
    padding: '12px 14px',
  }, [
    c('&:hover', { background: hover }),
  ]),
  c('.dshp-extension__card.dshp-extension__card--muted', { opacity: '.55' }),
  c('.dshp-extension__card-top', { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }),
  c('.dshp-extension__card-row', { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }),
  c('.dshp-extension__card-title', {
    flex: '1',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '14px',
    lineHeight: '20px',
    fontWeight: '600',
    fontFamily: 'var(--ds-font-family-code)',
  }),
  c('.dshp-extension__card-desc', {
    margin: '0',
    fontSize: '12px',
    lineHeight: '18px',
    color: secondary,
    display: '-webkit-box',
    WebkitLineClamp: '2',
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }),
  c('.dshp-extension__tag', {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: '20px',
    borderRadius: '5px',
    padding: '1px 6px',
    background: layer1,
    color: secondary,
    fontSize: '11px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  }, [
    c('&[data-kind="source"]', {
      background: `color-mix(in srgb,${business} 10%,transparent)`,
      color: business,
    }),
    c('&[data-kind="off"]', {
      background: 'color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-tertiary)) 12%,transparent)',
      color: secondary,
    }),
  ]),
  c('.dshp-extension__code', {
    fontFamily: 'var(--ds-font-family-code)',
    fontSize: '11px',
    lineHeight: '17px',
    whiteSpace: 'pre',
    margin: '8px 0',
    padding: '10px 12px',
    overflowX: 'auto',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    background: layer3,
  }),
  c('@media (max-width: 680px)', [
    c('.dshp-extension__cards', { gridTemplateColumns: 'minmax(0,1fr)' }),
    c('.dshp-extension__search', { width: '140px' }),
  ]),
])
