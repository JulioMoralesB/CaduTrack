import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutosave } from '@/hooks/useAutosave'

const DELAY = 500

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

function deferred() {
  let resolve: () => void = () => {}
  let reject: (reason: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAutosave — see #146', () => {
  it('waits for the delay, then saves only the newest value', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<number>(save, DELAY))

    act(() => {
      result.current.schedule(1)
      result.current.schedule(2)
    })
    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('saving')

    await act(() => vi.advanceTimersByTimeAsync(DELAY))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(2)
    expect(result.current.status).toBe('saved')
  })

  it('never overlaps saves: a change during one goes out after it', async () => {
    const first = deferred()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<number>(save, DELAY))

    act(() => result.current.schedule(1))
    await act(() => vi.advanceTimersByTimeAsync(DELAY))
    act(() => result.current.schedule(2))
    await act(() => vi.advanceTimersByTimeAsync(DELAY))
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve()
      await first.promise
    })

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenLastCalledWith(2)
  })

  it('reports a failure and retries the same value on flush', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<number>(save, DELAY))

    act(() => result.current.schedule(1))
    await act(() => vi.advanceTimersByTimeAsync(DELAY))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Ocurrió un error inesperado.')

    let saved = false
    await act(async () => {
      saved = await result.current.flush()
    })

    expect(saved).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(1)
    expect(result.current.error).toBeNull()
  })

  it('flush sends a waiting value at once and reports failure', async () => {
    const save = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAutosave<number>(save, DELAY))

    act(() => result.current.schedule(1))
    let saved = true
    await act(async () => {
      saved = await result.current.flush()
    })

    expect(saved).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush with nothing waiting does not save', async () => {
    const save = vi.fn()
    const { result } = renderHook(() => useAutosave<number>(save, DELAY))

    await expect(result.current.flush()).resolves.toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('cancel forgets a waiting value', async () => {
    const save = vi.fn()
    const { result } = renderHook(() => useAutosave<number>(save, DELAY))

    act(() => {
      result.current.schedule(1)
      result.current.cancel()
    })
    await act(() => vi.advanceTimersByTimeAsync(DELAY))

    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('still sends a waiting value when unmounted', () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useAutosave<number>(save, DELAY))

    act(() => result.current.schedule(1))
    unmount()

    expect(save).toHaveBeenCalledWith(1)
  })
})
