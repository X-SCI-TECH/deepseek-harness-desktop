/**
 * host/routes/index.ts — turnrewind HTTP 路由（客户端 UI 唯一的数据面）。
 *
 *   GET  /api/turnrewind/summary?sessionId=<id>  读本会话的 turn 变更记录
 *   POST /api/turnrewind/undo                    撤销某个 turn 的文件改动
 *
 * 两条路由都经 dsh-tauri 的 routeHandler（方法严格限制、mutate 仅回环 + JSON 校验）；
 * 连接信任边界用 `ctx.get('connection')` 可选获取——服务缺席时优雅降级为
 * routeHandler 自身的回环校验，不因未注入而让插件 fiber 卡在 PENDING（见方案 2.4-B3/B5）。
 */

import type { HostContext, JsonBody, SummaryPayload } from '../types'
import { routeHandler, withConnectionAuth } from 'dsh-tauri'
import { MAX_SUMMARY_FILES, REASON_GIT_REQUIRED } from '../constants'
import { TURNREWIND_API_PREFIX, TURNREWIND_PLUGIN_NAME } from '../../shared/constants'
import { currentDshHome, readLedger } from '../service/ledger'
import { undoTurn } from '../service/undo'
import { findSession, probeWorkspace, sessionCwdOf } from '../service/workspace'

/** 构建路由列表。 */
export function buildRoutes(ctx: HostContext, options: { dshHome?: string } = {}): any[] {
  const dshHome = options.dshHome ?? currentDshHome()
  // 连接信任边界是可选能力：服务缺席时 withConnectionAuth 原样放行，
  // 由 routeHandler 自己的回环校验兜底（绝不因未注入而卡住 fiber）。
  const connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined

  const summaryHandler = routeHandler(async (_body: JsonBody, req: any): Promise<[number, unknown]> => {
    const url = new URL(req?.url ?? '/', 'http://localhost')
    const sessionId = String(url.searchParams.get('sessionId') ?? '')
    if (sessionId.length === 0)
      return [400, { error: '缺少 sessionId' }]
    const session = findSession(ctx, sessionId)
    if (session === undefined)
      return [404, { error: '会话不存在或尚未就绪' }]
    const ledger = await readLedger(dshHome, sessionId)
    // 以**当前**资格为准（cwd 可能在会话中途切换）：账本里的旧结论只作为兜底。
    const probe = await probeWorkspace(sessionCwdOf(session))
    // 非 Git → false（客户端点撤销弹「需要 Git 仓库」）；「确实是 Git 仓库但被守卫拒绝」
    // （家目录/盘根等）保留 true，只呈现不可用原因，不误报缺少仓库。
    const refusedGitWorkspace = !probe.ok && probe.reason !== REASON_GIT_REQUIRED && ledger.isGit
    const isGit = probe.ok || refusedGitWorkspace
    const payload: SummaryPayload = {
      sessionId,
      isGit,
      workspaceRoot: probe.ok ? probe.root : ledger.workspaceRoot,
      unavailableReason: probe.ok ? null : (probe.reason ?? ledger.unavailableReason),
      turns: ledger.turns.map((turn) => {
        const truncated = turn.files.length > MAX_SUMMARY_FILES
        return {
          turn: turn.turn,
          fileCount: turn.files.length,
          insertions: turn.insertions,
          deletions: turn.deletions,
          undoneAt: turn.undoneAt ?? null,
          unavailable: turn.unavailable ?? null,
          truncated,
          files: truncated ? turn.files.slice(0, MAX_SUMMARY_FILES) : turn.files,
        }
      }),
    }
    return [200, payload]
  })

  const undoHandler = routeHandler(async (body: JsonBody): Promise<[number, unknown]> => {
    const sessionId = String(body.sessionId ?? '')
    const turn = Number(body.turn)
    if (sessionId.length === 0)
      return [400, { error: '缺少 sessionId' }]
    if (!Number.isInteger(turn) || turn <= 0)
      return [400, { error: 'turn 必须是正整数' }]
    const session = findSession(ctx, sessionId)
    if (session === undefined)
      return [404, { error: '会话不存在或尚未就绪' }]
    const probe = await probeWorkspace(sessionCwdOf(session))
    // 归属校验用当前 worktree 根；探测失败时传 null，由 service 层按账本判定。
    const outcome = await undoTurn({ dshHome, sessionId, turn, currentWorkspace: probe.ok ? probe.root : null })
    if (outcome.ok)
      return [200, { ok: true, restored: outcome.restored, removed: outcome.removed, failed: outcome.failed }]
    return [outcome.code, { error: outcome.error, conflicts: outcome.conflicts ?? [] }]
  }, { mutate: true })

  return [
    { kind: 'exact', path: `${TURNREWIND_API_PREFIX}/summary`, handler: withConnectionAuth(connection, summaryHandler, TURNREWIND_PLUGIN_NAME) },
    { kind: 'exact', path: `${TURNREWIND_API_PREFIX}/undo`, handler: withConnectionAuth(connection, undoHandler, TURNREWIND_PLUGIN_NAME) },
  ]
}
