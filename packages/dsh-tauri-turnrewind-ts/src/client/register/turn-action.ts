/**
 * client/register/turn-action.ts — 把「撤销本轮」按钮注册进助手消息动作条。
 *
 * 槽位是 list 型（追加、按 order 排序、与 copy/branch/点赞同排），注册形态是
 *   ctx.slots.register({ name, id, order, locale }, Component)
 * ——owner 只传 `{ messageId }`，turn 号由组件自己从会话快照反查。
 *
 * 历史教训（别再改回 `conversation.chat.turnTail`）：那是**选择器路由的 chain
 * 槽位**，框架每处只渲染第一个 select 命中的注册；核心 ui-deliverables 已经占了
 * 它，且只要该 turn 产出过文件就恒命中——正是最需要撤销的场景，我们的注册会被
 * 永久挤掉（线上表现为「只有没产出文件的 turn 才有按钮」）。
 *
 * ctx 类型用结构化接口而非 cordis Context（版本差异，与 command-view 同因）。
 */

import type { SlotHost } from '../types'
import { TurnUndoAction } from '../components/turn-undo'
import { TURN_UNDO_ID, TURN_UNDO_ORDER, TURN_UNDO_SLOT, TURNREWIND_LOCALE_NS } from '../constants'

/** 注册动作条槽位；effect 卸载时释放 inject 句柄。 */
export function registerTurnUndo(ctx: SlotHost): () => void {
  return ctx.slots.inject(
    TURN_UNDO_SLOT as never,
    () =>
      ctx.slots.register(
        {
          name: TURN_UNDO_SLOT,
          id: TURN_UNDO_ID,
          order: TURN_UNDO_ORDER,
          locale: TURNREWIND_LOCALE_NS,
        },
        TurnUndoAction,
      ),
  )
}
