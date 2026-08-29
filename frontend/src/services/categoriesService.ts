import { api } from '@/services/api'
import type { Category } from '@/services/types'

/** Categories, alphabetically. */
export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>('/categories')
  return data
}

export async function createCategory(name: string): Promise<Category> {
  const { data } = await api.post<Category>('/categories', { name })
  return data
}

/** Deletes the label only — its products survive, uncategorised. */
export async function deleteCategory(id: number): Promise<void> {
  await api.delete(`/categories/${id}`)
}
