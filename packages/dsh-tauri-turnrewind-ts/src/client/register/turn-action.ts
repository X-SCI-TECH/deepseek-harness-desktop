/**
 * client/register/turn-action.ts — 在完成 turn 的尾部注册「撤销本轮」按钮。
 *
 * 槽位 `conversation.chat.turnTail` 由 DSH 会话视图对每个完成的 turn 渲染，
 * props 带该轮的 turn 号（见 TurnTailProps）。ctx 类型用结构化接口而非
 * cordis Context（版本差异，与 register/command-view.ts 同因）。
 */

import type { SlotHost } from '../types'
import { TurnUndoButton } from '../components/turn-undo'
import { TURN_UNDO_ID, TURN_UNDO_KEY, TURN_UNDO_SLOT } from '../constants'

/** 注册 turn 尾部槽位；effect 卸载时释放 inject 句柄。 */
export function registerTurnUndo(ctx: SlotHost): () => void {
  return ctx.slots.inject(
    TURN_UNDO_SLOT as never,
    () =>
      ctx.slots.register(
        {
          name: TURN_UNDO_SLOT,
          id: TURN_UNDO_ID,
          key: TURN_UNDO_KEY,
        } as never,
        TurnUndoButton,
      ),
  )
}
