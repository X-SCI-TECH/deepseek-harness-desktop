import type { LiveSnapshot } from '../types'
import { useEffect, useState } from 'react'
import { getLive } from '../apis'
import { TURNREWIND_LIVE_POLL_INTERVAL_MS } from '../constants'

/**
 * 运行中实时读数（`client/hooks/`）。
 *
 * 宿主侧自己按 1.5s 刷新 git 读数、路由只读内存，所以客户端这里的轮询成本极低；
 * 反过来宿主无法主动推给客户端（不引入投影/事件轴的复杂度），故用固定间隔轮询。
 * 卸载时立刻停表；`shouldPoll` 为 false 时（会话明确未在运行）连轮询都不开。
 *
 * @param sessionId - 当前会话 id。
 * @param shouldPoll - 是否允许轮询（owner 份额明确说「没在跑」时置 false）。
 * @returns 最新读数；无活动 turn 时为 null。
 */
export function useLiveChanges(sessionId: string | undefined, shouldPoll: boolean): LiveSnapshot | null {
  const [live, setLive] = useState<LiveSnapshot | null>(null)

  useEffect(() => {
    if (sessionId === undefined || !shouldPoll)
      return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const next = await getLive(sessionId)
        if (!cancelled)
          setLive(next.active ? next : null)
      }
      catch {
        // 读数失败只影响提示条：静默清空，不打断会话。
        if (!cancelled)
          setLive(null)
      }
      if (!cancelled)
        timer = setTimeout(() => void tick(), TURNREWIND_LIVE_POLL_INTERVAL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined)
        clearTimeout(timer)
    }
  }, [sessionId, shouldPoll])

  return live
}
