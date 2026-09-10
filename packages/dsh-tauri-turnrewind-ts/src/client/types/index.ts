/**
 * client/types/index.ts — 客户端共享类型。
 */

import type { LocaleKey } from '../locales'

export type { LocaleKey } from '../locales'

/** 卡片里单个文件条目（解析 /undo 预览输出得到）。 */
export interface ParsedUndoFile {
  path: string
  change: 'modified' | 'created' | 'deleted' | 'conflict'
  additions: number
  deletions: number
  diff: string[]
  conflict: boolean
}

/** /undo 输出的解析结果（summary / 文件清单 / diff 分隔 / plan id）。 */
export interface ParsedUndoOutput {
  summary: string
  files: ParsedUndoFile[]
  dividers: string[]
  planId: string | undefined
}

/** plan 状态轮询结果。 */
export interface PlanStatusResolution {
  status: 'pending' | 'applied' | 'cancelled' | 'expired' | 'gone' | 'error' | null
  stop: boolean
  resultText: string | null
}

/** /undo 命令卡片槽位组件的 props（P2-10：集中到 client/types）。 */
export interface CommandViewProps {
  node?: { id?: string, name?: string, sessionId?: string, outcome?: { kind?: string, text?: string } }
  sessionId?: string
}

/** locale 取词函数：apply 装配层按当前活跃语言注入，组件层消费。 */
export type Translate = (key: LocaleKey) => string

/**
 * 槽位宿主：结构化接口而非 cordis Context——上游 cordis 版本的 Context 有
 * 更多必需属性，直接引用会因类型版本差异在 CI 上报 TS2345。
 *
 * `register` 的 options 覆盖两类槽位形态：keyed（commandview 用 `key`）与
 * list（动作条用 `id` + `order`，可选 `locale`/`inject`）。
 */
export interface SlotHost {
  slots: {
    inject: (slot: string, factory: () => () => void) => () => void
    register: (options: {
      name: string
      id?: string
      key?: string
      order?: number
      locale?: string
      inject?: unknown
    }, component: unknown) => () => void
  }
}

/** 会话快照上的选择器钩子（框架标准 kit；会话作用域槽位组件都会拿到）。 */
export type SessionSelectorHook = <T>(selector: (snapshot: never) => T) => T

/**
 * `conversation.chat.assistant-actions` 的槽位 props：owner 只给这一条消息的
 * 身份，turn 号由组件自己从会话快照反查（见 utils/turn-action 的
 * `selectTurnForMessage`）。`sessionId`/`useSession` 来自框架标准 kit。
 */
export interface TurnActionProps {
  /** 该动作条所属的已定稿助手消息 id。 */
  messageId?: unknown
  /** 当前会话 id（框架标准 kit）。 */
  sessionId?: unknown
  /** 会话快照选择器钩子（框架标准 kit）。 */
  useSession?: SessionSelectorHook
  /** locale 取词（注册时声明了 locale 命名空间才会注入）。 */
  t?: Translate
}

/** turn 尾部按钮的装配通道（apply 注入，register 侧组件消费）。 */
export interface TurnActionChannel {
  translate: Translate
  /** 当前活跃会话 id；未选中会话时返回 null。 */
  sessionId: () => string | null
  /** 执行一条命令（错误时返回文案，成功返回 null）。 */
  runCommand: (line: string) => Promise<string | null>
}

/** 恢复面板行（host GET /api/turnrewind/recovery 的 workspaces 条目）。 */
export interface RecoveryWorkspaceInfo {
  workspace_key: string
  workspace_path: string | null
  operations: {
    operation_id: string
    kind: string
    target_turn_id: string
    requested_at: string
    settled_at: string | null
    error: string | null
  }[]
}
