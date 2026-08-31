import { AxiosError } from 'axios'

/**
 * Waits between attempts, in milliseconds. The array length is the number of
 * *retries*, so three attempts in all.
 *
 * Deliberately short. This exists for a connection that blinks for a fraction
 * of a second — the reported case recovered on a manual retry a moment later.
 * A longer schedule would leave the user watching a spinner during the failure
 * it cannot fix, which is worse than telling them quickly.
 */
const RETRY_DELAYS_MS = [300, 900] as const

/**
 * True when a failed request can be repeated without risking a duplicate.
 *
 * The question is not "did it fail" but "could the server have processed it
 * anyway". Two cases must never be retried:
 *
 *   * **A timeout.** The request was sent and the answer never came back. The
 *     API may well have committed the write, so repeating it would create a
 *     second product.
 *   * **Any HTTP response, 5xx included.** A gateway error can mean the
 *     upstream died halfway through handling the request, which has the same
 *     problem. A 4xx will fail identically however many times it is sent.
 *
 * That leaves `ERR_NETWORK`: no response, and the failure sits at the
 * connection level. In practice this is a request that never arrived — a
 * refused connection, a name that would not resolve, a radio that dropped
 * before anything went out.
 *
 * "In practice" is doing real work in that sentence. The browser also reports
 * `ERR_NETWORK` when a connection dies after the request was already on the
 * wire, and nothing here can tell the two apart. Making it airtight needs an
 * idempotency key the API can deduplicate against; the residual risk is
 * accepted for now and written down in the issue rather than hidden here.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof AxiosError)) return false
  return error.code === AxiosError.ERR_NETWORK
}

/**
 * Run `operation`, repeating it while the failure looks safe to repeat.
 *
 * The delays are a parameter so tests can drive the real logic without waiting
 * on real timers.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  delaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= delaysMs.length || !isRetryable(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}
