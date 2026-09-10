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

  it('卡片形态：白底 + 14px 圆角 + 36px 图标块 + 「审核」胶囊按钮', () => {
    expect(css).toMatch(/\.dshp-turnrewind__card\s*\{[^}]*background: var\(--dsw-alias-bg-base/)
    expect(css).toMatch(/\.dshp-turnrewind__card\s*\{[^}]*border-radius: 14px/)
    expect(css).toMatch(/\.dshp-turnrewind__icon\s*\{[^}]*width: 36px/)
    expect(css).toMatch(/\.dshp-turnrewind__icon\s*\{[^}]*height: 36px/)
    expect(css).toMatch(/\.dshp-turnrewind__review\s*\{[^}]*border-radius: 999px/)
    expect(css).toMatch(/\.dshp-turnrewind__title\s*\{[^}]*font-weight: 600/)
  })

  it('字号整体收小：标题 13 / 副行 13 / 清单行 13 / 徽标 11', () => {
    expect(css).toMatch(/\.dshp-turnrewind__title\s*\{[^}]*font-size: 13px/)
    expect(css).toMatch(/\.dshp-turnrewind__sub\s*\{[^}]*font-size: 13px/)
    expect(css).toMatch(/\.dshp-turnrewind__file\s*\{[^}]*font-size: 13px/)
    expect(css).toMatch(/\.dshp-turnrewind__badge\s*\{[^}]*font-size: 11px/)
  })

  it('hover「查看更改」当前整体停用：无 hover 换行规则，提示默认不占位', () => {
    // 需求：hover 效果与打开文件暂时全部停用，只显示 +xx -x（恢复见 CSSR 内 TODO 注释）。
    expect(css).not.toMatch(/\.dshp-turnrewind__card--single:hover/)
    expect(css).not.toMatch(/\.dshp-turnrewind__card:hover/)
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
