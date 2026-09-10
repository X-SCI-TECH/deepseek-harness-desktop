/**
 * client/components/turn-undo.ts — 助手消息动作条里的「撤销本轮」按钮。
 *
 * 只负责定位与提交：owner 只给 `messageId`，turn 号经会话快照反查
 * （selectTurnForMessage），再走官方命令通道执行 `/undo <turn-id>`——预览卡、
 * 冲突校验、plan 绑定等全部由既有命令链路承担，按钮本身不做任何恢复动作。
 */

import type { TurnActionProps } from '../types'
import React, { useState } from 'react'
import { TURNREWIND_CLASS_PREFIX } from '../constants'
import { selectTurnForMessage, turnIdFor, undoCommandLine } from '../utils/turn-action'
import { turnActionChannel } from '../utils/turn-action-channel'

/** 宿主没给 `useSession` 时的占位选择器：恒返回 null（不定位 → 按钮不渲染）。 */
function absentSelector<T>(selector: (snapshot: never) => T): T | null {
  return selector(undefined as never)
}

/** 按钮前缀图标：环形箭头（与动作条里的既有图标同一观感）。 */
function UndoIcon(): React.ReactElement {
  return React.createElement(
    'svg',
    {
      'className': `${TURNREWIND_CLASS_PREFIX}-turn-undo-icon`,
      'viewBox': '0 0 16 16',
      'width': '14',
      'height': '14',
      'fill': 'none',
      'stroke': 'currentColor',
      'strokeWidth': '1.4',
      'strokeLinecap': 'round',
      'strokeLinejoin': 'round',
      'aria-hidden': 'true',
    },
    React.createElement('path', { d: 'M3.4 8a4.6 4.6 0 1 0 1.5-3.4' }),
    React.createElement('path', { d: 'M3 2.2v3.2h3.2' }),
  )
}

/**
 * 动作条槽位组件：无法定位会话/turn 或通道未装配时渲染 null（不占位）。
 *
 * `sessionId`/`useSession` 来自框架的会话标准 kit：`useSession` 把 owner 给的
 * messageId 反查成 turn 号（见 `selectTurnForMessage`）。它是 Hook，必须先无条件
 * 调用再判空早退。
 * @param props - 槽位 props（messageId + 标准 kit）。
 * @returns 撤销按钮，或 null。
 */
export function TurnUndoAction(props: TurnActionProps): React.ReactElement | null {
  const channel = turnActionChannel()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messageId = typeof props.messageId === 'string' ? props.messageId : null
  // props.useSession 是框架标准 kit 注入的选择器 Hook。它必须**无条件**调用
  // （React Hooks 规则），所以宿主没给时用恒返回 null 的占位实现顶替，而不是
  // 条件调用——条件调用在 HMR/老宿主上会打乱 Hook 顺序。
  const sessionSelector = typeof props.useSession === 'function' ? props.useSession : absentSelector
  const turn = sessionSelector(snapshot => selectTurnForMessage(snapshot, messageId))
  const sessionId = typeof props.sessionId === 'string' && props.sessionId.length > 0
    ? props.sessionId
    : channel === null ? null : channel.sessionId()
  const turnId = turnIdFor(sessionId, turn)

  if (!channel || turnId === null)
    return null

  const label = channel.translate('turnUndoLabel')
  const caption = React.createElement(
    'span',
    { className: `${TURNREWIND_CLASS_PREFIX}-turn-undo-text` },
    busy ? channel.translate('turnUndoBusy') : label,
  )
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
    React.createElement(
      'button',
      {
        'type': 'button',
        'className': `${TURNREWIND_CLASS_PREFIX}-turn-undo`,
        'title': label,
        'aria-label': label,
        'disabled': busy,
        'onClick': submit,
      },
      React.createElement(UndoIcon),
      caption,
    ),
    error === null
      ? null
      : React.createElement('span', { className: `${TURNREWIND_CLASS_PREFIX}-turn-undo-error` }, error),
  )
}
