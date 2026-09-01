import type { Product } from '@/services/types'

/**
 * The active product this name most likely duplicates, if any — see #108.
 *
 * Consumed products are excluded explicitly, not just trusted to already
 * be missing from whatever list is passed in: a same-day re-buy of
 * something already finished is a fresh purchase, not a duplicate, and
 * that has to hold regardless of whether the caller's list happens to
 * include consumed rows.
 *
 * Matching is exact once normalized (trimmed, case-insensitive) rather
 * than fuzzy: a fuzzy match trades false negatives for false positives,
 * and a wrong warning erodes trust in this check faster than an occasional
 * missed one does.
 */
export function findDuplicateToday(products: Product[], name: string): Product | null {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return null

  const today = new Date().toDateString()
  return (
    products.find(
      (product) =>
        product.consumed_at === null &&
        product.name.trim().toLowerCase() === normalized &&
        new Date(product.created_at).toDateString() === today,
    ) ?? null
  )
}
