import { api } from '@/services/api'
import { withRetry } from '@/services/retry'
import type { Product, ProductFilters, ProductPayload } from '@/services/types'

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
