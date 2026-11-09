import { useCallback, useEffect, useRef, useState } from 'react'

import { toErrorMessage } from '@/services/api'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface Autosave<T> {
  status: AutosaveStatus
  error: string | null
  /** Saves `value` once `delayMs` pass with no newer one. */
  schedule: (value: T) => void
  /** Forgets anything not yet sent, e.g. a value that is no longer valid. */
  cancel: () => void
  /** Sends anything waiting right away. True once everything is saved. */
  flush: () => Promise<boolean>
}

/**
 * Save-as-you-go for one resource — see #146.
 *
 * Saves run one at a time and only the newest waiting value is sent, so a
 * slow request can never land after a newer one and overwrite it. A failed
 * value stays waiting, for the next change or flush to retry.
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delayMs: number): Autosave<T> {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const saveRef = useRef(save)
  const waiting = useRef<{ value: T } | null>(null)
  const timer = useRef<number | null>(null)
  const running = useRef<Promise<boolean> | null>(null)

  useEffect(() => {
    saveRef.current = save
  }, [save])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const drain = useCallback((): Promise<boolean> => {
    if (running.current) return running.current

    running.current = (async () => {
      setStatus('saving')
      setError(null)
      let saved = true
      while (waiting.current) {
        const { value } = waiting.current
        waiting.current = null
        try {
          await saveRef.current(value)
          saved = true
        } catch (caught) {
          saved = false
          // Not over a newer value that arrived during this attempt.
          waiting.current ??= { value }
          setError(toErrorMessage(caught))
          break
        }
      }
      running.current = null
      setStatus(saved ? 'saved' : 'error')
      return saved
    })()
    return running.current
  }, [])

  const schedule = useCallback(
    (value: T) => {
      waiting.current = { value }
      setStatus('saving')
      setError(null)
      clearTimer()
      timer.current = window.setTimeout(() => {
        timer.current = null
        void drain()
      }, delayMs)
    },
    [clearTimer, delayMs, drain],
  )

  const cancel = useCallback(() => {
    clearTimer()
    waiting.current = null
    if (!running.current) {
      setStatus('idle')
      setError(null)
    }
  }, [clearTimer])

  const flush = useCallback((): Promise<boolean> => {
    clearTimer()
    if (!waiting.current && !running.current) return Promise.resolve(true)
    return drain()
  }, [clearTimer, drain])

  // Leaving by any route other than flush must not lose the last change.
  useEffect(
    () => () => {
      if (timer.current === null) return
      clearTimer()
      void drain()
    },
    [clearTimer, drain],
  )

  return { status, error, schedule, cancel, flush }
}
