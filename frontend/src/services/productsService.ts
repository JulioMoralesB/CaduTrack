import { api } from '@/services/api'
import { withRetry } from '@/services/retry'
import type { IconReassignmentResult, Product, ProductFilters, ProductPayload } from '@/services/types'

export interface ProductListResult {
  products: Product[]
  /**
   * When this copy was cached, or null when it came from the network.
   *
   * The service worker stamps only the copy it stores, so the absence of the
   * header is what "this is current" means.
   */
  cachedAt: Date | null
}

/** Products, soonest to expire first. The backend does the ordering. */
export async function listProducts(filters: ProductFilters = {}): Promise<ProductListResult> {
  const response = await api.get<Product[]>('/products', { params: filters })
  // Axios types headers loosely; narrow before trusting it.
  const stamp: unknown = response.headers['x-cached-at']
  return {
    products: response.data,
    cachedAt: typeof stamp === 'string' ? new Date(stamp) : null,
  }
}

export async function getProduct(id: number): Promise<Product> {
  const { data } = await api.get<Product>(`/products/${id}`)
  return data
}

/**
 * Retried on a dropped connection: adding something from a phone in a kitchen
 * fails often enough that one blink should not cost the user the whole form.
 * `withRetry` only repeats what cannot have been processed — see its comments
 * for why a timeout is excluded.
 */
export async function createProduct(payload: ProductPayload): Promise<Product> {
  const { data } = await withRetry(() => api.post<Product>('/products', payload))
  return data
}

/**
 * Full replace: fields left out of the payload are cleared.
 *
 * Safer to retry than the POST above — PUT sends the whole intended state, so
 * a repeat that lands twice leaves the product exactly as asked either way.
 */
export async function replaceProduct(id: number, payload: ProductPayload): Promise<Product> {
  const { data } = await withRetry(() => api.put<Product>(`/products/${id}`, payload))
  return data
}

/**
 * Not retried. A repeat that follows a delete which actually succeeded gets a
 * 404, and the user would be shown an error for an action that worked.
 */
export async function deleteProduct(id: number): Promise<void> {
  await api.delete(`/products/${id}`)
}

/**
 * Consumed products, most recently consumed first. See #31.
 */
export async function listConsumedProducts(): Promise<Product[]> {
  const { data } = await api.get<Product[]>('/products/history')
  return data
}

/**
 * Mark a product as consumed, moving it from the active list to history.
 *
 * Not retried, on the same reasoning as deleteProduct above: a repeat that
 * follows a consume which actually succeeded gets a 409 (the backend rejects
 * consuming an already-consumed product), and the user would be shown an
 * error for an action that worked.
 */
export async function consumeProduct(id: number): Promise<Product> {
  const { data } = await api.post<Product>(`/products/${id}/consume`)
  return data
}

/** Undo a consumed mark, returning a product to the active list. Not
 *  retried, for the same reason as consumeProduct. */
export async function restoreProduct(id: number): Promise<Product> {
  const { data } = await api.post<Product>(`/products/${id}/restore`)
  return data
}

/**
 * Adjust a product's quantity by a relative amount — never an absolute value,
 * so two taps racing on a slow connection compose correctly regardless of
 * arrival order. See the backend's ProductQuantityDelta and #82.
 *
 * Retried on the same terms as createProduct/replaceProduct: a stepper button
 * is tapped from a phone near the fridge, exactly the situation #81 was
 * written for, so a dropped-connection tap deserves the same second chance.
 */
export async function adjustProductQuantity(id: number, delta: number): Promise<Product> {
  const { data } = await withRetry(() => api.patch<Product>(`/products/${id}/quantity`, { delta }))
  return data
}

/**
 * Manually set a product's icon. The only call that can produce
 * icon_source: 'manual' — see the backend endpoint's own docstring.
 */
export async function setProductIcon(id: number, icon: string): Promise<Product> {
  const { data } = await withRetry(() => api.patch<Product>(`/products/${id}/icon`, { icon }))
  return data
}

/**
 * Re-run icon resolution for every product still at the fallback — the ones
 * that existed before icons shipped, or that missed while AI was off. Never
 * touches a product with a real answer already (lookup, ai) or a manual
 * override; see the backend endpoint's own docstring for why that is safe by
 * construction rather than by convention.
 */
export async function reassignIcons(): Promise<IconReassignmentResult> {
  const { data } = await withRetry(() => api.post<IconReassignmentResult>('/products/icons/reassign'))
  return data
}
