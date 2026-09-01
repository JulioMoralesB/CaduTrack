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
  /**
   * Splice one already-saved product back into the list from its own server
   * response, in place of a full reload.
   *
   * Built for the quantity stepper: a full `reload()` after every +/- tap
   * would refetch the whole list — and briefly show a stale sort order, since
   * a product's position depends on `expires_at`, not quantity — for a change
   * that only ever touches one row and one field.
   */
  replaceProduct: (updated: Product) => void
  /**
   * Drop one product from the list without a full reload.
   *
   * Built for marking a product consumed: unlike a quantity or icon change,
   * the row does not get updated in place, it leaves the active list
   * entirely — replaceProduct would have nowhere to put it back.
   */
  removeProduct: (id: number) => void
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

  // Escaping a stale list should not need a manual reload.
  //
  // Two triggers, because neither is sufficient. The `online` event misses the
  // common cases: a device that believes it is connected behind a broken
  // network, and DevTools' offline simulation, which does not dispatch it at
  // all. Returning to the tab is the trigger that actually fires in the real
  // path — phone into pocket, phone out of pocket, in front of the fridge.
  useEffect(() => {
    const refresh = () => setReloadNonce((nonce) => nonce + 1)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // An event handler, not an effect — same reasoning as reload above.
  const replaceProduct = useCallback((updated: Product) => {
    setProducts((current) => current.map((product) => (product.id === updated.id ? updated : product)))
  }, [])

  const removeProduct = useCallback((id: number) => {
    setProducts((current) => current.filter((product) => product.id !== id))
  }, [])

  return { products, loading, error, cachedAt, reload, replaceProduct, removeProduct }
}
