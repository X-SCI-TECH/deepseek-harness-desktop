import { describe, expect, it, vi } from 'vitest'

import cardStyle from './turn-changes-card.cssr'

// dsh-tauri-ui/client 的 dist bundle 以 `window.__ModuleLoader__.load(...)` 包裹，
// 脱离宿主加载器后无法在 node 环境求值；把该导入 mock 到同一 cssr 实例的源文件，
// 使样式树能在测试里直接 render() 核对选择器形态（与 dsh-tauri-panel 同款做法）。
vi.mock('dsh-tauri-ui/client', async () => {
  const mod = await import('../../../../dsh-tauri-ui/src/client/cssr.ts')
  return { cssr: mod.cssr }
})

describe('turn-changes-card.cssr（视觉对齐官方 deliverables 行）', () => {
  const css = cardStyle.render()

  it('卡片形态：白底 + 14px 圆角 + 40px 图标块 + 「审核」胶囊按钮', () => {
    expect(css).toMatch(/\.dshp-turnrewind__card\s*\{[^}]*background: var\(--dsw-alias-bg-base/)
    expect(css).toMatch(/\.dshp-turnrewind__card\s*\{[^}]*border-radius: 14px/)
    expect(css).toMatch(/\.dshp-turnrewind__icon\s*\{[^}]*width: 40px/)
    expect(css).toMatch(/\.dshp-turnrewind__icon\s*\{[^}]*height: 40px/)
    expect(css).toMatch(/\.dshp-turnrewind__review\s*\{[^}]*border-radius: 999px/)
    expect(css).toMatch(/\.dshp-turnrewind__title\s*\{[^}]*font-weight: 600/)
  })

  it('单文件卡片 hover：计数行隐藏、「查看更改」出现（纯 CSS 切换）', () => {
    expect(css).toMatch(/\.dshp-turnrewind__card--single:hover \.dshp-turnrewind__counts\s*\{[^}]*display: none/)
    expect(css).toMatch(/\.dshp-turnrewind__card--single:hover \.dshp-turnrewind__hint\s*\{[^}]*display: inline-flex/)
    // 非 hover 时提示默认不占位
    expect(css).toMatch(/\.dshp-turnrewind__hint\s*\{[^}]*display: none/)
  })

  it('文件行：hover 高亮；本轮删除的文件整行弱化', () => {
    expect(css).toMatch(/\.dshp-turnrewind__file:hover\s*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover/)
    expect(css).toMatch(/\.dshp-turnrewind__file--deleted\s*\{[^}]*color: var\(--dsw-alias-label-tertiary/)
  })

  it('文件清单与「再显示」行之间用分隔线收口', () => {
    expect(css).toMatch(/\.dshp-turnrewind__files\s*\{[^}]*border-top: 1px solid/)
    expect(css).toMatch(/\.dshp-turnrewind__more\s*\{[^}]*border-top: 1px solid/)
  })
})
