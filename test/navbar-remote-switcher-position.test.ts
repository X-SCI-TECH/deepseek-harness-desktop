/**
 * navbar-remote-switcher-position.test.ts — 「本地 / 远端」切换器紧邻「帮助」的位置契约。
 *
 * 为什么用源码关系断言而不是渲染断言：`unit` project 是 node 环境（见
 * `navbar-run-menu.test.ts` 同款说明），壳层组件的契约以源码关系锁定。
 *
 * 位置回归的关键是「切换器必须排在 `flex-1` 拖拽区之前」——这条关系一旦破坏，
 * 视觉上它就会重新落回窗口按钮旁（本 issue 的原始症状）。仅断言 "在帮助之后"
 * 是不够的：它原本也在帮助之后，问题恰恰出在拖拽区把它隔开了。
 */
import { describe, expect, it } from 'vitest'
import { readSource } from './setup/read-source'

const navbarSource = readSource('src/layout/components/navbar.tsx')

/** 用 data-testid / 组件名做锚点，不依赖行号，避免无关改动导致脆断。 */
const HELP_ANCHOR = 'data-testid="dsh-navbar-menu-help"'
const SWITCHER_ANCHOR = '<RemoteSwitcher'
const CHIP_ANCHOR = 'update.chip_available'
const DRAG_REGION = 'data-testid="dsh-navbar-drag-region"'

describe('导航栏「帮助」右侧的环境切换入口', () => {
  const helpIndex = navbarSource.indexOf(HELP_ANCHOR)
  const switcherIndex = navbarSource.indexOf(SWITCHER_ANCHOR)
  const chipIndex = navbarSource.indexOf(CHIP_ANCHOR)
  const dragIndex = navbarSource.indexOf(DRAG_REGION)

  it('四个锚点在源码中都存在', () => {
    expect(helpIndex).toBeGreaterThan(-1)
    expect(switcherIndex).toBeGreaterThan(-1)
    expect(chipIndex).toBeGreaterThan(-1)
    expect(dragIndex).toBeGreaterThan(-1)
  })

  it('切换器排在「帮助」之后', () => {
    expect(switcherIndex).toBeGreaterThan(helpIndex)
  })

  // 核心回归点：排在 flex-1 拖拽区之后 = 视觉上被推到右侧按钮组（即原始症状）。
  it('切换器排在拖拽区之前，不被推到窗口按钮旁', () => {
    expect(switcherIndex).toBeLessThan(dragIndex)
  })

  it('顺序为：帮助 → 远端切换器 → 更新可用 chip', () => {
    expect(helpIndex).toBeLessThan(switcherIndex)
    expect(switcherIndex).toBeLessThan(chipIndex)
  })

  it('切换器保留 onToggleSidebar 可见性判定，避免无 iframe 时出现死按钮', () => {
    expect(navbarSource).toMatch(/<RemoteSwitcher[^>]*visible=\{onToggleSidebar != null\}/)
  })

  it('注释不再声称切换器固定在「右侧」', () => {
    // 旧注释曾写「固定在右侧」，改动后必须同步。
    expect(navbarSource).not.toMatch(/RemoteSwitcher[^\n]*固定在右侧/)
  })
})
