import { api } from '@/services/api'
import type { Product, ProductFilters, ProductPayload } from '@/services/types'

/** Products, soonest to expire first. The backend does the ordering. */
export async function listProducts(filters: ProductFilters = {}): Promise<Product[]> {
  const { data } = await api.get<Product[]>('/products', { params: filters })
  return data
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
