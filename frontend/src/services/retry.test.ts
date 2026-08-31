import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { isRetryable, withRetry } from '@/services/retry'

/** No waiting: the delays are a parameter precisely so tests skip real timers. */
const NO_WAIT = [0, 0] as const

function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK)
}

function timeoutError(): AxiosError {
  return new AxiosError('timeout of 0ms exceeded', AxiosError.ECONNABORTED)
}

function httpError(status: number): AxiosError {
  const error = new AxiosError('Request failed')
  error.response = {
    data: '',
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  }
  return error
}

describe('isRetryable', () => {
  it('repeats a dropped connection, which never reached the API', () => {
    expect(isRetryable(networkError())).toBe(true)
  })

  it('refuses to repeat a timeout, because the write may already have landed', () => {
    // The whole point of the distinction: a timeout means the request was sent
    // and only the answer was lost. Retrying it is how duplicates are created.
    expect(isRetryable(timeoutError())).toBe(false)
  })

  it('refuses to repeat a gateway error, which can mean a half-finished write', () => {
    expect(isRetryable(httpError(502))).toBe(false)
  })

  it('refuses to repeat a rejected payload, which would fail identically', () => {
    expect(isRetryable(httpError(422))).toBe(false)
  })

  it('ignores anything that is not an Axios failure', () => {
    expect(isRetryable(new Error('boom'))).toBe(false)
  })
})

describe('withRetry', () => {
  it('recovers from the reported case: one blink, then the connection is back', async () => {
    const operation = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue('saved')

    await expect(withRetry(operation, NO_WAIT)).resolves.toBe('saved')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('does not call the operation again after a timeout', async () => {
    const operation = vi.fn().mockRejectedValue(timeoutError())

    await expect(withRetry(operation, NO_WAIT)).rejects.toThrow('timeout of 0ms exceeded')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('does not call the operation again after an HTTP error', async () => {
    const operation = vi.fn().mockRejectedValue(httpError(422))

    await expect(withRetry(operation, NO_WAIT)).rejects.toBeInstanceOf(AxiosError)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('stops after the last delay and surfaces the failure', async () => {
    const operation = vi.fn().mockRejectedValue(networkError())

    await expect(withRetry(operation, NO_WAIT)).rejects.toThrow('Network Error')
    // Two delays means three attempts, not two.
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('succeeds without retrying when nothing goes wrong', async () => {
    const operation = vi.fn().mockResolvedValue('saved')

    await expect(withRetry(operation, NO_WAIT)).resolves.toBe('saved')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('waits between attempts rather than hammering the connection', async () => {
    const operation = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue('saved')
    const started = Date.now()

    await withRetry(operation, [40])

    expect(Date.now() - started).toBeGreaterThanOrEqual(35)
  })
})
