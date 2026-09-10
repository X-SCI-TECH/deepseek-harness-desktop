/**
 * client/register/command-view.ts — /undo 命令卡片（红绿 diff + 徽标 + 确认/取消）的 slot 注册。
 *
 * ctx 类型用结构化接口（client/types 的 SlotHost）而非 cordis Context：上游
 * cordis 版本的 Context 有更多必需属性，直接引用会因类型版本差异在 CI 上报 TS2345。
 */

import type { SlotHost } from '../types'
import { UndoCommandView } from '../components/command-view'
import { COMMAND_VIEW_ID, COMMAND_VIEW_KEY, COMMAND_VIEW_SLOT } from '../constants'

/** 注册 conversation.chat.commandview 槽位；effect 卸载时释放 inject 句柄。 */
export function registerCommandView(ctx: SlotHost): () => void {
  // `as never` 是结构性必需：cordis 的槽名类型联合只覆盖官方静态槽位，
  // 插件自定义槽名（conversation.chat.commandview）无法进入该联合。
  return ctx.slots.inject(
    COMMAND_VIEW_SLOT as never,
    () =>
      ctx.slots.register(
        {
          name: COMMAND_VIEW_SLOT,
          id: COMMAND_VIEW_ID,
          key: COMMAND_VIEW_KEY,
        } as never,
        UndoCommandView,
      ),
  )
}
