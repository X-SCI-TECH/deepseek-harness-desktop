/**
 * client/constants/index.ts — 客户端共享常量。
 */

/** 卡片轮询 plan 状态的间隔。 */
export const TURNREWIND_POLL_INTERVAL_MS = 2000

/** 轮询停止前的最长时长。 */
export const TURNREWIND_POLL_STOP_MS = 120000

/** 弹窗样式 style id。 */
export const TURNREWIND_STYLE_ID = 'dsh-tauri-turnrewind-dialog'

/** 卡片/弹窗 CSS class 前缀。 */
export const TURNREWIND_CLASS_PREFIX = 'dsh-turnrewind'

/** /undo 命令卡片槽位（DSH 会话命令视图标准槽）。 */
export const COMMAND_VIEW_SLOT = 'conversation.chat.commandview'

/** 命令卡片在槽内的注册 id。 */
export const COMMAND_VIEW_ID = 'turnrewind-undo-card'

/** keyed slot 的 key（同一 slot 的多个组件按 key 区分）。 */
export const COMMAND_VIEW_KEY = 'undo'

/** effect 标签（诊断/日志）。 */
export const COMMAND_VIEW_EFFECT = 'turnrewind command view'

/**
 * 撤销按钮所在的槽位：助手消息动作条（每个完成的 turn 渲染一次）。
 *
 * **不能用 `conversation.chat.turnTail`**：那是 chain（选择器路由）槽位，框架
 * 每处只渲染**第一个** select 命中的注册（见 ui-renderer 的 chain 分支 `break`），
 * 而核心 `@deepseek-ai/dsh-client-ui-deliverables` 已经占了它——只要该 turn 产出过
 * 文件，它的 select 就命中，我们的注册永远轮不到，而「产出过文件」恰恰是最需要
 * 撤销的场景。`conversation.chat.assistant-actions` 是 list 槽位（追加、按 order
 * 排序、与 copy/branch/点赞同排），才是「给一条消息加动作」的正规座位。
 */
export const TURN_UNDO_SLOT = 'conversation.chat.assistant-actions'

/** 撤销按钮在动作条槽内的注册 id（list 槽位内唯一）。 */
export const TURN_UNDO_ID = 'turnrewind-undo'

/** 动作条内的排列顺序（核心 copy/branch 与反馈按钮在前）。 */
export const TURN_UNDO_ORDER = 20

/** effect 标签（诊断/日志）。 */
export const TURN_UNDO_EFFECT = 'turnrewind turn action'

/** locale 命名空间（不可用弹窗双语）。 */
export const TURNREWIND_LOCALE_NS = 'dsh-tauri-turnrewind'

/** 同源 HTTP 路由前缀——唯一来源是 shared/constants，此处仅别名转发。 */
export { TURNREWIND_API_PREFIX as TURNREWIND_HTTP_BASE } from '../../shared/constants'
