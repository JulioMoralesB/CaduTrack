import { useCallback, useEffect, useState } from 'react'

import { toErrorMessage } from '@/services/api'
import { listProducts } from '@/services/productsService'
import type { Product, ProductFilters } from '@/services/types'

interface UseProductsResult {
  products: Product[]
  loading: boolean
  error: string | null
  /** Set when the list came from the offline cache rather than the network. */
  cachedAt: Date | null
  reload: () => void
}

/**
 * Loads the product list, exposing the states the UI has to render.
 *
 * State is only ever set from the async continuation, never synchronously in
 * the effect body — the latter causes the cascading renders that
 * react-hooks/set-state-in-effect warns about. A consequence worth knowing:
 * when the filters change, the current rows stay on screen while the new ones
 * load instead of flashing a spinner. For a list you are reading in front of
 * an open fridge, that is the better behaviour anyway.
 */
export function useProducts(filters: ProductFilters = {}): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<Date | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Depend on the serialized filters: a fresh object literal on every render
  // would restart the request forever.
  const filterKey = JSON.stringify(filters)

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const result = await listProducts(JSON.parse(filterKey) as ProductFilters)
        if (active) {
          setProducts(result.products)
          setCachedAt(result.cachedAt)
          setError(null)
        }
      } catch (caught) {
        if (active) setError(toErrorMessage(caught))
      } finally {
        if (active) setLoading(false)
      }
    })()

    // A filter change or an unmount must not let an in-flight response
    // overwrite newer state.
    return () => {
      active = false
    }
  }, [filterKey, reloadNonce])

  // An event handler, not an effect, so setting state here is fine.
  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    setReloadNonce((nonce) => nonce + 1)
  }, [])

  // Coming back into signal should refresh on its own. Having to pull down or
  // reload to escape a stale list is the sort of thing that makes an offline
  // cache feel broken rather than helpful.
  useEffect(() => {
    const onOnline = () => setReloadNonce((nonce) => nonce + 1)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  return { products, loading, error, cachedAt, reload }
}
