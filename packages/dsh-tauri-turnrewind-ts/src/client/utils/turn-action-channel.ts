/**
 * client/utils/turn-action-channel.ts — turn 尾部撤销按钮的装配通道。
 *
 * 槽位组件由 register/ 注册、依赖（取词、当前会话、命令执行）由 apply() 层
 * 注入，两者不互相 import。latest-owner-wins：HMR 时旧实例的 disposer 不会
 * 清掉新实例的通道（与 setSubmitLine / setCardTranslator 同一模式）。
 */

import type { TurnActionChannel } from '../types'

let channel: TurnActionChannel | null = null

export function setTurnActionChannel(next: TurnActionChannel | null): () => void {
  channel = next
  return () => {
    if (channel === next)
      channel = null
  }
}

/** 读取当前通道；未装配时按钮不渲染。 */
export function turnActionChannel(): TurnActionChannel | null {
  return channel
}
