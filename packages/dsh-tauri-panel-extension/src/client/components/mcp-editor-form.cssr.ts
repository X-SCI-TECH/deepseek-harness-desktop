import { cssr, styles as sharedStyles } from 'dsh-tauri-ui/client'

const { c } = cssr
const { primary, secondary, tertiary, borderL2: border, business, layer1 } = sharedStyles

/** MCP 服务器编辑器（mcp-editor-form.tsx）：表单 + 编辑器页签。 */
export default c([
  c('.dshp-extension__form', { display: 'flex', flexDirection: 'column', gap: '10px' }),
  c('.dshp-extension__editor-tabs', { display: 'flex', gap: '4px', borderBottom: `1px solid ${border}` }),
  c('.dshp-extension__editor-tab', {
    position: 'relative',
    border: '0',
    padding: '7px 10px 9px',
    background: 'transparent',
    color: tertiary,
    font: 'inherit',
    fontSize: '13px',
    lineHeight: '20px',
    cursor: 'pointer',
  }, [
    c('&:hover, &[data-active="true"]', { color: primary }),
    c('&[data-active="true"]::after', {
      position: 'absolute',
      right: '8px',
      bottom: '-1px',
      left: '8px',
      height: '2px',
      borderRadius: '2px 2px 0 0',
      background: primary,
      content: '""',
    }),
    c('&:focus-visible', {
      outline: `2px solid ${business}`,
      outlineOffset: '-2px',
      borderRadius: '4px',
      color: primary,
    }),
  ]),
  c('.dshp-extension__label', {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '12px',
    lineHeight: '18px',
    color: secondary,
  }, [
    c('& > span:first-child', { color: tertiary }),
  ]),
  c('.dshp-extension__input', {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    padding: '7px 10px',
    outline: 'none',
    background: layer1,
    color: primary,
    font: 'inherit',
    fontSize: '13px',
  }, [
    c('&:focus-visible', {
      borderColor: business,
      boxShadow: `0 0 0 2px color-mix(in srgb,${business} 18%,transparent)`,
    }),
  ]),
  c('.dshp-extension__textarea', {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    padding: '7px 10px',
    outline: 'none',
    background: layer1,
    color: primary,
    font: 'inherit',
    fontSize: '13px',
    minHeight: '320px',
    resize: 'vertical',
    fontFamily: 'var(--ds-font-family-code)',
    lineHeight: '1.5',
  }, [
    c('&[data-short="true"]', { minHeight: '96px' }),
    c('&:focus-visible', {
      borderColor: business,
      boxShadow: `0 0 0 2px color-mix(in srgb,${business} 18%,transparent)`,
    }),
  ]),
  c('.dshp-extension__select', {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${border}`,
    borderRadius: '8px',
    padding: '7px 10px',
    outline: 'none',
    background: layer1,
    color: primary,
    font: 'inherit',
    fontSize: '13px',
  }, [
    c('&:focus-visible', {
      borderColor: business,
      boxShadow: `0 0 0 2px color-mix(in srgb,${business} 18%,transparent)`,
    }),
  ]),
  c('.dshp-extension__json-editor', { minHeight: '260px' }),
  c('.dshp-extension__checks', {
    display: 'flex',
    gap: '16px',
    fontSize: '13px',
    lineHeight: '20px',
  }, [
    c('& label', {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      cursor: 'pointer',
      minWidth: '0',
    }),
  ]),
  c('.dshp-extension__import-choice', {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    minWidth: '0',
  }),
  c('.dshp-extension__import-choice.dshp-extension__import-choice--disabled', { cursor: 'default' }),
  c('.dshp-extension__form-error', {
    margin: '0',
    color: 'var(--dsw-alias-state-error-primary)',
    fontSize: '12px',
    lineHeight: '18px',
  }),
])
