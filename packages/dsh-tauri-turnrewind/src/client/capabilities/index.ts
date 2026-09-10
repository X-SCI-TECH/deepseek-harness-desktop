/**
 * client/capabilities/index.ts — 运行时能力探测（跨内核代，不做版本嗅探）。
 *
 * 「打开文件」在两个内核代上的含义**完全不同**：
 *
 * | 内核 | owner props 的 `openFile(path)` 实际做的事 |
 * |---|---|
 * | `0.1.5-rc.1` | `ctx.sidebarRight.openResource(fileAddress(...))` —— 在**应用内右侧边栏**打开文本预览页签 |
 * | `0.1.2-rc.1` | `ctx.remote.session.openWorkspacePath({ path })` —— 交给**宿主/系统**去打开该路径 |
 *
 * 需求是「像官方新核心那样打开侧边栏的文件，旧核心静默（不打开文件）」。两者都派发
 * `openFile`，因此**不能靠 `openFile` 是否存在**来区分；判据取「右侧边栏能力是否存在」：
 * 新内核由 `dsh-client-ui-sidebar-right` 经 `ctx.reflect.provide('sidebarRight', …)` 发布，
 * 旧内核连这个包都没有。用能力探测而不是版本号判断，内核再漂移也不会误开系统程序。
 *
 * 探测在**点击那一刻**做（而不是 apply 时）：`sidebarRight` 由另一个客户端插件发布，
 * apply 顺序不保证它已经就位。
 */

import type { ClientContext } from 'dsh-tauri/client'
import { TURNREWIND_SIDEBAR_RIGHT_SERVICE } from '../constants'

/** 已安装的上下文（apply 时注入；未安装 = 尚无能力信息，按「没有」处理）。 */
let context: ClientContext | undefined

/**
 * 安装能力探测所需的上下文。
 * @param ctx - 客户端根上下文。
 * @returns 卸载时清除引用的 disposer（避免插件卸载后残留旧上下文）。
 */
export function registerCapabilities(ctx: ClientContext): () => void {
  context = ctx
  return () => {
    if (context === ctx)
      context = undefined
  }
}

/**
 * 当前内核是否具备「应用内右侧边栏预览」能力。
 *
 * 用 `reflect.get` 读服务（cordis 的 reflect 直接查注册表，不受 inject 守卫限制），
 * 因此本插件无需 `inject: ['sidebarRight']`——那会让旧内核上的插件加载直接失败。
 * @returns 有 `sidebarRight` 服务时为 true。
 */
export function hasSidebarPreview(): boolean {
  const reflect = context?.reflect
  if (reflect === undefined || typeof reflect.get !== 'function')
    return false
  try {
    return reflect.get(TURNREWIND_SIDEBAR_RIGHT_SERVICE) !== undefined
  }
  catch {
    // 服务注册表在极端时序下可能抛错：按「没有该能力」处理，绝不因此报错。
    return false
  }
}
