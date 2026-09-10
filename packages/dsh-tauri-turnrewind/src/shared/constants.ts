/**
 * shared/constants.ts — 跨 host/client 的稳定协议常量。
 *
 * 插件名与 API 前缀是两半端共享的线协议面：host 侧路由注册、client 侧 RPC 各自
 * 硬编码必然漂移，集中在此由两端共同引用（AGENTS.plugins.md「客户端常量集中规则」）。
 */

/** 插件名（诊断元数据 / registrant / 存储目录名）。 */
export const TURNREWIND_PLUGIN_NAME = 'dsh-tauri-turnrewind'

/** HTTP 路由前缀（host 注册 + client 同源 fetch）。 */
export const TURNREWIND_API_PREFIX = '/api/turnrewind'
