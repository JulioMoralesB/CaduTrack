import { useCallback, useEffect, useRef, useState } from 'react'

import { requestWake, serverIsUp, wakeAvailable } from '@/services/wakeService'

/** How often to check whether the server is back. */
export const WAKE_POLL_MS = 5_000

/** When to stop waiting. Booting takes about two minutes, the VM a bit more. */
export const WAKE_GIVE_UP_MS = 4 * 60_000

export type WakePhase =
  /** Not offered: the server is reachable, or this deployment has no Worker. */
  | 'unavailable'
  | 'idle'
  /** Asked; checking every WAKE_POLL_MS until it answers. */
  | 'waking'
  /** The request to turn it on did not go through. */
  | 'failed'
  /** Asked, but it never answered within WAKE_GIVE_UP_MS. */
  | 'timedOut'

export interface WakeServer {
  phase: WakePhase
  /** Start, or start over after a failure or a timeout. */
  start: () => void
}

/**
 * "Encender servidor" — see edge/wake/README.md.
 *
 * Lives in ProductList rather than in the button itself: the button shows in
 * two places (the error state and the stale-data banner), and the error state
 * unmounts while a retry is loading. Waiting has to outlive both.
 *
 * `active` is whether the server looks unreachable right now. `onAwake` runs
 * once it answers again, to load everything fresh — data only, never a page
 * reload, so a form opened while waiting is not thrown away.
 */
export function useWakeServer(active: boolean, onAwake: () => void): WakeServer {
  const [available, setAvailable] = useState(false)
  const [phase, setPhase] = useState<Exclude<WakePhase, 'unavailable'>>('idle')
  const timer = useRef<number | undefined>(undefined)
  const onAwakeRef = useRef(onAwake)

  useEffect(() => {
    onAwakeRef.current = onAwake
  }, [onAwake])

  // Asked once per stretch of being unreachable, not on every render.
  useEffect(() => {
    if (!active || available) return
    let current = true
    void wakeAvailable().then((yes) => {
      if (current) setAvailable(yes)
    })
    return () => {
      current = false
    }
  }, [active, available])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const start = useCallback(() => {
    window.clearTimeout(timer.current)
    setPhase('waking')
    void (async () => {
      try {
        await requestWake()
      } catch {
        setPhase('failed')
        return
      }
      const deadline = Date.now() + WAKE_GIVE_UP_MS
      const check = async () => {
        if (await serverIsUp()) {
          setPhase('idle')
          onAwakeRef.current()
          return
        }
        if (Date.now() >= deadline) {
          setPhase('timedOut')
          return
        }
        timer.current = window.setTimeout(() => void check(), WAKE_POLL_MS)
      }
      timer.current = window.setTimeout(() => void check(), WAKE_POLL_MS)
    })()
  }, [])

  // Still shown while waking even if `active` flips (a retry loading, say):
  // the wait is what matters then.
  const shown = available && (active || phase === 'waking')
  return { phase: shown ? phase : 'unavailable', start }
}
