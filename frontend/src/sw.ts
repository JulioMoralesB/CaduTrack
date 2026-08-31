/// <reference lib="webworker" />

/**
 * Service worker.
 *
 * Two jobs: precache the built shell so the app opens without a network, and
 * keep the last product list so opening it offline shows something real
 * instead of an error. Caching only the shell — the original plan — would have
 * produced an app that loads and then immediately fails, which is worse than
 * not being installable at all.
 */

import { clientsClaim } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

/** Header stamped onto cached copies so the UI can say how old they are. */
const CACHED_AT = 'x-cached-at'

precacheAndRoute(self.__WB_MANIFEST)

self.skipWaiting().catch(() => {
  // Nothing to do: the next load picks up the new worker anyway.
})
clientsClaim()

/**
 * Record when a response was stored.
 *
 * Only the cached copy is stamped — Workbox hands the page the original network
 * response — so the absence of this header is exactly what "this came from the
 * network" means. Showing stale data unlabelled would be worse than an error,
 * because it is data you would act on.
 */
const stampCacheDate = {
  cacheWillUpdate: async ({ response }: { response: Response }) => {
    if (response.status !== 200) return null

    const headers = new Headers(response.headers)
    headers.set(CACHED_AT, new Date().toISOString())
    return new Response(await response.clone().blob(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}

/**
 * Treat a broken server the same as no signal.
 *
 * NetworkFirst only falls back to the cache when the request *throws*, which
 * covers a device with no connectivity. A reachable server returning 502 is a
 * perfectly good response as far as Workbox is concerned, so the page would get
 * the error instead of the list. Standing in front of the fridge those two
 * situations are the same thing, and the last known list beats both.
 */
const treatServerErrorsAsOffline = {
  // Not async: there is nothing to await, and Workbox awaits whatever it gets.
  fetchDidSucceed: ({ response }: { response: Response }) => {
    if (response.status >= 500) {
      throw new Error(`Upstream returned ${response.status}`)
    }
    return response
  },
}

registerRoute(
  // Reads only. A queued write replayed from a stale cache could resurrect a
  // product that was deleted, so mutations are deliberately never cached.
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/products'),
  new NetworkFirst({
    cacheName: 'cadutrack-products',
    networkTimeoutSeconds: 5,
    plugins: [treatServerErrorsAsOffline, stampCacheDate],
  }),
)
