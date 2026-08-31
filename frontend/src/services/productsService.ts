import { api } from '@/services/api'
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

export async function createProduct(payload: ProductPayload): Promise<Product> {
  const { data } = await api.post<Product>('/products', payload)
  return data
}

/** Full replace: fields left out of the payload are cleared. */
export async function replaceProduct(id: number, payload: ProductPayload): Promise<Product> {
  const { data } = await api.put<Product>(`/products/${id}`, payload)
  return data
}

export async function deleteProduct(id: number): Promise<void> {
  await api.delete(`/products/${id}`)
}
