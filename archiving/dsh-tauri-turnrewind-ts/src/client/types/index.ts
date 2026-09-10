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
 */
export interface SlotHost {
  slots: {
    inject: (slot: string, factory: () => () => void) => () => void
    register: (options: { name: string, id: string, key: string }, component: unknown) => () => void
  }
}

/** `conversation.chat.turnTail` 的槽位 props（DSH 每个完成 turn 渲染一次）。 */
export interface TurnTailProps {
  /** DSH 事件里的数字 turn 号（账本 turn id 的后半段）。 */
  turn?: unknown
  seq?: unknown
  openFile?: unknown
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
