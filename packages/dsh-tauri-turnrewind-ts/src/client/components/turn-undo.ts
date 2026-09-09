/**
 * client/components/turn-undo.ts — turn 尾部「撤销本轮」按钮。
 *
 * 只负责定位与提交：把 `conversation.chat.turnTail` 的 turn 号拼成账本
 * turn id，再走官方命令通道执行 `/undo <turn-id>`——预览卡、冲突校验、
 * plan 绑定等全部由既有命令链路承担，按钮本身不做任何恢复动作。
 */

import type { TurnTailProps } from '../types'
import React, { useState } from 'react'
import { TURNREWIND_CLASS_PREFIX } from '../constants'
import { turnIdFor, undoCommandLine } from '../utils/turn-action'
import { turnActionChannel } from '../utils/turn-action-channel'

/** 槽位组件：无法定位会话/turn 或通道未装配时渲染 null（不占位）。 */
export function TurnUndoButton(props: TurnTailProps): React.ReactElement | null {
  const channel = turnActionChannel()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const turnId = channel ? turnIdFor(channel.sessionId(), props.turn) : null

  if (!channel || turnId === null)
    return null

  const submit = (): void => {
    if (busy)
      return
    setBusy(true)
    setError(null)
    void channel.runCommand(undoCommandLine(turnId)).then((failure) => {
      setBusy(false)
      if (failure !== null)
        setError(`${channel.translate('turnUndoFailed')}${failure}`)
    })
  }

  return React.createElement(
    'div',
    { className: `${TURNREWIND_CLASS_PREFIX}-turn-undo-row` },
    React.createElement('button', {
      type: 'button',
      className: `${TURNREWIND_CLASS_PREFIX}-turn-undo`,
      disabled: busy,
      onClick: submit,
    }, busy ? channel.translate('turnUndoBusy') : channel.translate('turnUndoLabel')),
    error === null
      ? null
      : React.createElement('span', { className: `${TURNREWIND_CLASS_PREFIX}-turn-undo-error` }, error),
  )
}
