/**
 * client/utils/turn-action.ts — turn 尾部撤销按钮的纯函数与命令通道解析。
 *
 * 槽位 `conversation.chat.turnTail` 的 props 带 `turn`（DSH 事件里的数字
 * turn 号）。账本的 turn id 与宿主一致，形如 `<sessionId>:<turn>`，所以按钮
 * 能精确定位到被点击的那一轮，而不是只撤最新一轮。
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
