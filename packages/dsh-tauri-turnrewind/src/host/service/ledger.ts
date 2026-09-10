/**
 * host/service/ledger.ts — 每会话 JSON 账本（原子写 + 进程内串行）。
 *
 * 存放于 `$DSH_HOME/<feature>/sessions/<sessionId>.json`。选 JSON 而非 SQLite：
 * 本插件的读写面只有「追加一条 turn、标记一次撤销、读一份摘要」，事务需求为零；
 * 原子写由 dsh-tauri 的 `writeAtomic`（tmp + rename，Windows 锁竞争有界退避）承担。
 *
 * 同一会话的 load-modify-save 全部经过 {@link withSessionLock} 串行化，
 * 避免「捕获结算」与「撤销回写」交叉覆盖（AGENTS.plugins.md 宿主侧规则）。
 */

import type { SessionLedger, TurnRecord } from '../types'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import process from 'node:process'
import { writeAtomic } from 'dsh-tauri'
import { join } from 'pathe'
import { LEDGER_VERSION, MAX_TURNS_PER_SESSION, SNAPSHOT_FEATURE_DIR } from '../constants'

/** 账本目录（DSH_HOME 可被环境变量覆盖，与 dsh-tauri 的存储口径一致）。 */
export function ledgerDir(dshHome: string): string {
  return join(dshHome, SNAPSHOT_FEATURE_DIR, 'sessions')
}

/** 会话账本文件路径；会话 id 做文件名安全化并附短哈希防撞。 */
export function ledgerPath(dshHome: string, sessionId: string): string {
  const sanitized = sessionId.replace(/[^\w.-]/g, '_').slice(0, 96) || 'session'
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
  return join(ledgerDir(dshHome), `${sanitized}-${digest}.json`)
}

/** 空账本。 */
export function blankLedger(sessionId: string): SessionLedger {
  return {
    version: LEDGER_VERSION,
    sessionId,
    workspaceRoot: null,
    isGit: false,
    unavailableReason: null,
    turns: [],
  }
}

/** 读取账本；文件缺失/损坏/版本不符时返回空账本（损坏显式告警，不静默修数据）。 */
export async function readLedger(dshHome: string, sessionId: string): Promise<SessionLedger> {
  try {
    const raw = await readFile(ledgerPath(dshHome, sessionId), 'utf8')
    const parsed = JSON.parse(raw) as SessionLedger
    if (parsed === null || typeof parsed !== 'object' || parsed.sessionId !== sessionId)
      return blankLedger(sessionId)
    if (parsed.version !== LEDGER_VERSION || !Array.isArray(parsed.turns)) {
      console.warn(`[dsh-tauri-turnrewind] ledger for session ${sessionId} has an unsupported version; starting fresh`)
      return blankLedger(sessionId)
    }
    return {
      version: LEDGER_VERSION,
      sessionId,
      workspaceRoot: typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : null,
      isGit: parsed.isGit === true,
      unavailableReason: typeof parsed.unavailableReason === 'string' ? parsed.unavailableReason : null,
      turns: parsed.turns.filter(turn => typeof turn?.turn === 'number' && Array.isArray(turn.files)),
    }
  }
  catch {
    return blankLedger(sessionId)
  }
}

/** 写入账本（原子）。 */
export async function writeLedger(dshHome: string, ledger: SessionLedger): Promise<void> {
  await writeAtomic(ledgerPath(dshHome, ledger.sessionId), `${JSON.stringify(ledger, null, 2)}\n`)
}

/** 每会话串行队列：返回当前队尾的 promise 并接上本次任务。 */
const sessionQueues = new Map<string, Promise<unknown>>()

/**
 * 在会话级串行区内执行 load-modify-save。
 * @param dshHome - 宿主数据根目录。
 * @param sessionId - 会话 id（队列键）。
 * @param task - 收到当前账本，返回要落盘的账本（null 表示无需写入）。
 * @returns 落盘时被淘汰的 turn 记录（调用方据此删除快照 refs）。
 */
export async function mutateLedger(
  dshHome: string,
  sessionId: string,
  task: (ledger: SessionLedger) => SessionLedger | null,
): Promise<{ evicted: TurnRecord[] }> {
  const previous = sessionQueues.get(sessionId) ?? Promise.resolve()
  const run = previous.then(async () => {
    const ledger = await readLedger(dshHome, sessionId)
    const next = task(ledger)
    if (next === null)
      return { evicted: [] as TurnRecord[] }
    const evicted = next.turns.length > MAX_TURNS_PER_SESSION
      ? next.turns.slice(0, next.turns.length - MAX_TURNS_PER_SESSION)
      : []
    if (evicted.length > 0)
      next.turns = next.turns.slice(-MAX_TURNS_PER_SESSION)
    await writeLedger(dshHome, next)
    return { evicted }
  })
  // 队列只保留最新一环，失败也要让后续任务继续（否则一次损坏会永久卡住该会话）。
  sessionQueues.set(sessionId, run.catch(() => undefined))
  return run
}

/** 记录工作区资格结论（非 Git / 拒绝目录也要留痕，供客户端呈现不可用态）。 */
export async function recordWorkspaceState(
  dshHome: string,
  sessionId: string,
  state: { workspaceRoot: string | null, isGit: boolean, unavailableReason: string | null },
): Promise<void> {
  await mutateLedger(dshHome, sessionId, (ledger) => {
    if (ledger.workspaceRoot === state.workspaceRoot
      && ledger.isGit === state.isGit
      && ledger.unavailableReason === state.unavailableReason) {
      return null
    }
    return { ...ledger, ...state }
  })
}

/** 追加/覆盖某 turn 的记录。 */
export async function recordTurn(dshHome: string, sessionId: string, record: TurnRecord): Promise<void> {
  await mutateLedger(dshHome, sessionId, (ledger) => {
    const turns = ledger.turns.filter(item => item.turn !== record.turn)
    turns.push(record)
    turns.sort((left, right) => left.turn - right.turn)
    return { ...ledger, turns }
  })
}

/** 标记某 turn 已撤销；返回是否命中记录。 */
export async function markTurnUndone(dshHome: string, sessionId: string, turn: number, at: number): Promise<boolean> {
  let hit = false
  await mutateLedger(dshHome, sessionId, (ledger) => {
    const target = ledger.turns.find(item => item.turn === turn)
    if (target === undefined)
      return null
    hit = true
    return {
      ...ledger,
      turns: ledger.turns.map(item => (item.turn === turn ? { ...item, undoneAt: at } : item)),
    }
  })
  return hit
}

/** 进程内是否还有未落定的会话写入（诊断/测试用）。 */
export function pendingLedgerWrites(): number {
  return sessionQueues.size
}

/** 宿主数据根目录（`$DSH_HOME`，与 dsh-tauri 存储口径一致）。 */
export function currentDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}
