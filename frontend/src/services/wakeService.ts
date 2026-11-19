import axios from 'axios'

import { api } from '@/services/api'

/**
 * Turning the server on from the app — see edge/wake/README.md.
 *
 * The server is not always on. A small Cloudflare Worker answers at /wake on
 * the app's own hostname, on the edge, so it is there while the server is
 * off; all it can do is ask Home Assistant to switch the server on.
 *
 * /wake sits next to the app, not under /api: /api is the server itself, and
 * the whole point is to reach something while that is down. Same origin
 * either way, so the Cloudflare Access session cookie goes along on its own.
 */

/** Short: the edge answers fast, and a slow answer is no answer here. */
const WAKE_TIMEOUT_MS = 10_000

/** Shorter than the poll interval, so checks never pile up. */
const HEALTH_TIMEOUT_MS = 4_000

function wakeUrl(): string {
  return new URL('/wake', window.location.origin).toString()
}

/**
 * Whether this deployment has the Worker at all. Anything but its own exact
 * answer means no — a deployment without it answers /wake with the app's
 * index.html, or an error, and must not show a button that cannot work.
 */
export async function wakeAvailable(): Promise<boolean> {
  try {
    const { data } = await axios.get<unknown>(wakeUrl(), { timeout: WAKE_TIMEOUT_MS })
    return typeof data === 'object' && data !== null && (data as { wake?: unknown }).wake === true
  } catch {
    return false
  }
}

/** Ask for the server to be turned on. Resolves once the request was taken. */
export async function requestWake(): Promise<void> {
  await axios.post(wakeUrl(), undefined, { timeout: WAKE_TIMEOUT_MS })
}

/**
 * True once the API answers healthy — database included, so the list can
 * actually load. Never throws: down, still booting and a 503 all mean "not
 * yet".
 */
export async function serverIsUp(): Promise<boolean> {
  try {
    await api.get('/health', { timeout: HEALTH_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}
