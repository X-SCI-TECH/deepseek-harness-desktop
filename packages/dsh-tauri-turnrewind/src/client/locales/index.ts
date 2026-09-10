/**
 * client/locales/index.ts — 本插件界面文案（zh / en 双语）。
 *
 * 用 locale 服务的非类型化注册面（register(ns, locale, dict)）挂进 dsh 的 locale 表：
 * zh/en 键集齐全即满足运行时双语平衡约束，无需增广 LocaleNamespaceMap（两内核的
 * locale 服务都同时支持 3 参与 2 参重载，已核实实现逐字一致）。
 * 组件侧不取框架 `t` 座，改用极薄的 uSES 桥（与 dsh-tauri-worktree 同款）：
 * apply 时订阅 locale 变更推进 rev，组件订阅 rev 重渲染。
 */

import type { ClientContext } from 'dsh-tauri/client'
import type { LocaleKey } from '../types'
import { createExternalStore } from 'dsh-tauri/client'
import { useSyncExternalStore } from 'react'
import { TURNREWIND_LOCALE_NAMESPACE as NS } from '../constants'

export { TURNREWIND_LOCALE_NAMESPACE as NS } from '../constants'
export type { LocaleKey } from '../types'

/** zh 字典（键集合的权威）。 */
const DICT_ZH = {
  fileButton: '文件',
  editedOne: '已编辑 {name}',
  editedMany: '已编辑 {count} 个文件',
  undo: '撤销',
  undoing: '撤销中…',
  review: '审核',
  viewChanges: '查看更改',
  moreFiles: '再显示 {count} 个文件',
  collapseFiles: '收起文件',
  undoneBadge: '已撤销',
  runningChanged: '{count} 个文件已更改',
  binary: '二进制',
  unavailableTitle: '撤销不可用',
  unavailableGitDesc: '该工作区不是 Git 代码仓库，无法记录可撤销的快照。',
  unavailableReason: '原因：{reason}',
  undoFailed: '撤销失败：{reason}',
  conflictTitle: '以下文件在撤销前又被修改，已拒绝执行（未改动任何文件）：',
  gitRequiredTitle: '撤销需要使用 Git 代码仓库',
  gitRequiredDesc: '此操作仅在 Git 代码仓库中运行时有效。',
  close: '关闭',
} as const satisfies Record<LocaleKey, string>

/** en 字典，与 zh 键集完全一致（locale 运行时强制双语平衡）。 */
const DICT_EN: Record<LocaleKey, string> = {
  fileButton: 'Files',
  editedOne: 'Edited {name}',
  editedMany: 'Edited {count} files',
  undo: 'Undo',
  undoing: 'Undoing…',
  review: 'Review',
  viewChanges: 'View changes',
  moreFiles: 'Show {count} more files',
  collapseFiles: 'Collapse files',
  undoneBadge: 'Undone',
  runningChanged: '{count} file(s) changed',
  binary: 'binary',
  unavailableTitle: 'Undo unavailable',
  unavailableGitDesc: 'This workspace is not a Git repository, so no restorable snapshot was recorded.',
  unavailableReason: 'Reason: {reason}',
  undoFailed: 'Undo failed: {reason}',
  conflictTitle: 'These files changed again before the undo — the undo was refused and no file was modified:',
  gitRequiredTitle: 'Undo requires a Git repository',
  gitRequiredDesc: 'This action only works when running inside a Git repository.',
  close: 'Close',
}

/** 活跃语言 id（module 级缓存，apply 时初始化并由订阅推进）。 */
let activeLocale = 'en'

/** locale 变更推进器：revision 前进 → uSES 订阅方重渲染。 */
export const localeRev = createExternalStore({ rev: 0 })

/**
 * 在 apply 里安装：注册本插件双语字典，并把 locale 变更桥接到 rev。
 * @param ctx - 客户端根上下文（须已注入 locale 服务）。
 * @returns 注销订阅的 disposer（交给 ctx.effect 管理）。
 */
export function registerLocale(ctx: ClientContext): () => void {
  activeLocale = ctx.locale.getLocale().active
  ctx.locale.register(NS, 'zh', DICT_ZH)
  ctx.locale.register(NS, 'en', DICT_EN)
  const off = ctx.locale.subscribe(() => {
    activeLocale = ctx.locale.getLocale().active
    localeRev.set(state => ({ ...state, rev: state.rev + 1 }))
  })
  return typeof off === 'function' ? off : () => {}
}

/** 取一条文案并填充 `{name}` 占位。 */
export function text(key: LocaleKey, params?: Record<string, string | number>): string {
  const dict: Record<LocaleKey, string> = activeLocale === 'en' ? DICT_EN : DICT_ZH
  const template = dict[key]
  if (params === undefined)
    return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    (name in params ? String(params[name]) : match))
}

/** 组件内订阅 locale 变更（revision 前进即重渲染）。 */
export function useLocale(): void {
  useSyncExternalStore(localeRev.subscribe, () => localeRev.getSnapshot().rev)
}
