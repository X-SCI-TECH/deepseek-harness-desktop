/**
 * client/capabilities/index.test.ts — 「打开文件」的内核能力判据。
 *
 * 守的是一条需求硬约束：**旧内核必须静默**（它同样派发 `openFile`，但会把路径交给
 * 宿主/系统去打开）。判据是「有没有 `sidebarRight` 服务」，不是版本号。
 */

import type { ClientContext } from 'dsh-tauri/client'
import { afterEach, describe, expect, it } from 'vitest'
import { hasSidebarPreview, registerCapabilities } from './index'

/** 最小上下文替身：只提供能力探测真正读到的 `reflect.get`。 */
function contextWith(service: unknown, options: { throws?: boolean } = {}): ClientContext {
  return {
    reflect: {
      get: () => {
        if (options.throws === true)
          throw new Error('registry unavailable')
        return service
      },
      provide: () => () => {},
    },
  } as unknown as ClientContext
}

afterEach(() => {
  // 每个用例都从「尚未安装」的干净状态开始：卸载即清引用。
  registerCapabilities(contextWith(undefined))()
})

describe('hasSidebarPreview', () => {
  it('未安装上下文时按「没有该能力」处理（绝不误开外部程序）', () => {
    registerCapabilities(contextWith(undefined))()
    expect(hasSidebarPreview()).toBe(false)
  })

  it('新内核：reflect 里有 sidebarRight 服务 → 可用', () => {
    registerCapabilities(contextWith({ openResource: () => {} }))
    expect(hasSidebarPreview()).toBe(true)
  })

  it('旧内核：没有 sidebarRight 服务 → 不可用（静默）', () => {
    // 旧内核的 reflect 里没有这个键，get 返回 undefined。
    registerCapabilities(contextWith(undefined))
    expect(hasSidebarPreview()).toBe(false)
  })

  it('注册表读取抛错时按不可用处理，不冒泡', () => {
    registerCapabilities(contextWith(undefined, { throws: true }))
    expect(hasSidebarPreview()).toBe(false)
  })

  it('缺少 reflect 的壳也不会崩', () => {
    registerCapabilities({} as unknown as ClientContext)
    expect(hasSidebarPreview()).toBe(false)
  })

  it('disposer 清掉引用后回到不可用', () => {
    const ctx = contextWith({ openResource: () => {} })
    const dispose = registerCapabilities(ctx)
    expect(hasSidebarPreview()).toBe(true)
    dispose()
    expect(hasSidebarPreview()).toBe(false)
  })

  it('disposer 只在仍是自己那次安装时才清引用（避免卸载旧实例清掉新实例）', () => {
    const first = contextWith({ openResource: () => {} })
    const second = contextWith({ openResource: () => {} })
    const disposeFirst = registerCapabilities(first)
    registerCapabilities(second)
    disposeFirst()
    expect(hasSidebarPreview()).toBe(true)
  })
})
