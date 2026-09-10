/**
 * host/apply.ts — turnrewind 插件装配（turn 生命周期接线 + HTTP 路由）。
 *
 * 装配顺序与原因：
 *   1. 捕获编排器先建（pre-step 到达时账本读写已就绪）；
 *   2. `agent/pre-step` 是唯一会 **await** 的钩子（执行屏障）；任何异常都吞掉后
 *      继续 `next()`——快照失败绝不能拦住用户的 turn（AGENTS.plugins.md 宿主侧规则）；
 *   3. `session/event` 的 turn/end 与 `agent/status → idle` 只做后台结算转发；
 *   4. 路由注册在 effect 内，卸载统一释放；捕获编排器同样在 effect 内 dispose。
 */

import type { HostContext } from './types'
import { TURNREWIND_PLUGIN_NAME } from '../shared/constants'
import { createTurnRewindHooks } from './hooks'
import { buildRoutes } from './routes'
import { createTurnCapture } from './service/capture'
import { currentDshHome } from './service/ledger'
import { sessionCwdOf } from './service/workspace'

/** 插件行配置（当前只有测试/调试用的数据目录覆盖）。 */
export interface PluginConfig {
  /** 覆盖宿主数据根目录（`$DSH_HOME`）；缺省走环境变量或 `~/.dsh`。 */
  dshHome?: string
}

/**
 * 插件体：注册 turn 生命周期钩子与 HTTP 路由。
 * @param ctx - 宿主根上下文（注入 webServer / sessions / agents）。
 * @param config - 插件行配置。
 */
export function apply(ctx: HostContext, config: PluginConfig = {}): void {
  const dshHome = typeof config?.dshHome === 'string' && config.dshHome.length > 0
    ? config.dshHome
    : currentDshHome()
  const hooks = createTurnRewindHooks()
  const capture = createTurnCapture(dshHome, ctx.logger, (sessionId, turn, fileCount) => {
    void hooks.callHook('turn:captured', sessionId, turn, fileCount)
  })

  // 1) 执行屏障：step === 1 时把 before 快照做在模型请求与工具执行之前。
  ctx.on('agent/pre-step', async (payload: any, next: () => Promise<any>) => {
    try {
      const sessionId = payload?.agent?.session?.id
      if (payload?.step === 1 && typeof sessionId === 'string' && typeof payload?.turn === 'number')
        await capture.beginTurn(sessionId, payload.turn, sessionCwdOf(payload.agent.session))
    }
    catch (error) {
      ctx.logger?.warn?.(`${TURNREWIND_PLUGIN_NAME}: before snapshot failed: ${String(error)}`)
    }
    return next()
  })

  // 2) turn 落定后后台结算 after 快照 / 差异 / 账本（不阻塞 turn 边界）。
  ctx.on('session/event', (session: any, event: any) => {
    if (event?.type !== 'turn/end')
      return
    const turn = event?.data?.turn
    if (typeof session?.id !== 'string' || typeof turn !== 'number')
      return
    void capture.settleTurn(session.id, turn).catch((error: unknown) => {
      ctx.logger?.warn?.(`${TURNREWIND_PLUGIN_NAME}: settle turn failed: ${String(error)}`)
    })
  })

  // 3) 兜底：被取消/中断而没走到 turn/end 的 turn，在会话空闲时结算。
  ctx.on('agent/status', (payload: any) => {
    if (payload?.status !== 'idle')
      return
    const sessionId = payload?.agent?.session?.id
    if (typeof sessionId !== 'string')
      return
    void capture.settleIdle(sessionId).catch((error: unknown) => {
      ctx.logger?.warn?.(`${TURNREWIND_PLUGIN_NAME}: idle settle failed: ${String(error)}`)
    })
  })

  // 4) HTTP 路由（客户端 UI 经此读摘要 / 执行撤销）。
  ctx.effect(() => {
    const disposers = buildRoutes(ctx, { dshHome }).map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers)
        dispose()
    }
  }, `${TURNREWIND_PLUGIN_NAME}: routes`)

  ctx.effect(() => () => capture.dispose(), `${TURNREWIND_PLUGIN_NAME}: turn capture`)
}
