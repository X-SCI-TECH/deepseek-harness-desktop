/**
 * client/utils/turn-action.ts — 撤销按钮的纯函数与命令通道解析。
 *
 * 按钮坐在 `conversation.chat.assistant-actions` 里，owner 只给消息 id，所以
 * turn 号要从会话快照（`snapshot.chat`）反查：账本的 turn id 与宿主一致，形如
 * `<sessionId>:<turn>`，因此按钮能精确定位被点击的那一轮，而不是只撤最新一轮。
 */

import type { Translate } from '../types'

/** 把槽位 turn 号与宿主会话 id 拼成账本 turn id；任一不合法即返回 null。 */
export function turnIdFor(sessionId: string | null | undefined, turn: unknown): string | null {
  if (typeof sessionId !== 'string' || sessionId.length === 0)
    return null
  const value = typeof turn === 'number'
    ? turn
    : typeof turn === 'string' && /^\d+$/u.test(turn) ? Number(turn) : Number.NaN
  if (!Number.isInteger(value) || value < 0)
    return null
  return `${sessionId}:${value}`
}

/** 按钮要执行的命令：与手敲 `/undo <turn-id>` 完全同一条路径。 */
export function undoCommandLine(turnId: string): string {
  return `/undo ${turnId}`
}

/**
 * 一个 chat 节点承载的 messageId → turn 号映射。
 *
 * 兼容两类载荷（都是同一个 turn 的不同渲染单元）：
 * - view 节点：`data` 里带载荷——turn-tail 用 `data.closing.finalNode.messageId`，
 *   assistant 用 `data.finalNode.messageId`（或扁平 `data.messageId`），配 `data.turn`；
 * - 旧版扁平节点（`chat.legacy.nodes`）：`{ kind:'assistant', messageId, turn }`
 *   直接挂在节点上，没有 `data` 包一层。
 * @returns 命中该消息时返回它的 turn 号，否则 null。
 */
export function turnForMessageNode(node: unknown, messageId: string): number | null {
  if (node === null || typeof node !== 'object')
    return null
  const record = node as Record<string, unknown>
  const data = record.data
  const payload = (data !== null && typeof data === 'object' ? data : record) as {
    turn?: unknown
    messageId?: unknown
    closing?: { finalNode?: { messageId?: unknown } }
    finalNode?: { messageId?: unknown }
  }
  if (typeof payload.turn !== 'number' || !Number.isInteger(payload.turn))
    return null
  const ids = [payload.messageId, payload.closing?.finalNode?.messageId, payload.finalNode?.messageId]
  return ids.includes(messageId) ? payload.turn : null
}

/**
 * 在会话快照里反查某条助手消息所属的 turn 号。
 *
 * 只读公开快照形状（`chat.order` + `chat.nodes` 的稳定 keyed reader），并用
 * `chat.legacy.nodes` 与直接 `.values()` 兜底不同宿主版本；任何形状不符都返回
 * null（按钮不渲染），绝不抛。
 */
export function selectTurnForMessage(snapshot: unknown, messageId: unknown): number | null {
  if (typeof messageId !== 'string' || messageId.length === 0)
    return null
  const chat = (snapshot as { chat?: unknown } | null | undefined)?.chat as {
    order?: unknown
    nodes?: { get?: unknown, values?: unknown }
    legacy?: { nodes?: unknown }
  } | undefined
  if (chat === null || typeof chat !== 'object')
    return null

  const candidates: unknown[] = []
  const order = chat.order
  const nodes = chat.nodes
  if (Array.isArray(order) && typeof nodes?.get === 'function') {
    for (const key of order)
      candidates.push((nodes.get as (key: unknown) => unknown).call(nodes, key))
  }
  else if (typeof nodes?.values === 'function') {
    const values = (nodes.values as () => unknown).call(nodes)
    if (Array.isArray(values))
      candidates.push(...values)
  }
  const legacy = chat.legacy?.nodes
  if (Array.isArray(legacy))
    candidates.push(...legacy)

  for (const node of candidates) {
    const turn = turnForMessageNode(node, messageId)
    if (turn !== null)
      return turn
  }
  return null
}

/** 命令执行函数：返回错误文案（供按钮显示），成功返回 null。 */
export type CommandRunner = (line: string, sessionId: string | null) => Promise<string | null>

/**
 * 解析宿主的 `ctx.remote.commands.execute(sessionId, line, images)`。
 * 这是「解析并执行已知命令、不发送给模型」的官方通道——按钮复用它，就能让
 * 既有 `/undo` 命令链路（预览卡、冲突校验、plan 绑定）原样生效。
 * 宿主未暴露该能力时返回 null，调用方据此不注册槽位（老版本宿主优雅降级）。
 */
export function resolveCommandRunner(ctx: unknown, translate: Translate): CommandRunner | null {
  let commands: { execute?: unknown } | undefined
  try {
    commands = (ctx as { remote?: { commands?: { execute?: unknown } } } | undefined)?.remote?.commands
  }
  catch {
    // 未在 inject 里声明 `remote`、或该服务尚未就绪时，cordis 的 context 代理对属性
    // 访问会直接抛。这里吞掉并降级为「不注册槽位」——按钮不出现，好过整个客户端插件
    // apply 失败（界面会报 Failed to load plugins）。
    return null
  }
  const execute = commands?.execute
  if (typeof execute !== 'function' || commands === undefined)
    return null
  const call = execute as (sessionId: string, line: string, images: string[]) => Promise<unknown>
  return async (line, sessionId) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0)
      return translate('sessionMissing')
    try {
      await call.call(commands, sessionId, line, [])
      return null
    }
    catch (error) {
      return String((error as Error)?.message ?? error)
    }
  }
}
