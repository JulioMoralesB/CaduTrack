/**
 * Filtering and sorting for the product list.
 *
 * Applied client-side rather than through the API's query parameters. A
 * household pantry is tens of items, so filtering in the browser is instant and
 * needs no round trip — and the status filter has no server-side equivalent
 * anyway, since translating it to SQL would mean CURRENT_DATE in the database's
 * timezone rather than the user's. The API's filters stay where they earn their
 * keep: the daily alert query in #21.
 */

import type { ExpiryStatus, Location, Product } from '@/services/types'

export interface ProductFilters {
  categoryId: number | 'all'
  location: Location | 'all'
  status: ExpiryStatus | 'all'
  /** Free text matched against the name — see #141. Empty matches all. */
  query: string
}

export type SortKey = 'expiry' | 'name'

export const NO_FILTERS: ProductFilters = {
  categoryId: 'all',
  location: 'all',
  status: 'all',
  query: '',
}

/** Case- and accent-insensitive: "platano" finds "Plátano", "JAMON" finds
 *  "jamón" — typing accents on a phone keyboard is exactly what nobody
 *  does in a search box. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function hasActiveFilters(filters: ProductFilters): boolean {
  return (
    filters.categoryId !== 'all' ||
    filters.location !== 'all' ||
    filters.status !== 'all' ||
    filters.query.trim() !== ''
  )
}

export function applyFilters(products: Product[], filters: ProductFilters): Product[] {
  const query = normalizeForSearch(filters.query)
  return products.filter((product) => {
    if (query !== '' && !normalizeForSearch(product.name).includes(query)) return false
    if (filters.categoryId !== 'all' && product.category_id !== filters.categoryId) return false
    if (filters.location !== 'all' && product.location !== filters.location) return false
    if (filters.status !== 'all' && product.status !== filters.status) return false
    return true
  })
}

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const sorted = [...products]

  if (sort === 'name') {
    // Locale-aware: otherwise "Ñame" sorts after "Zanahoria" and accented
    // names land in the wrong place.
    return sorted.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }

  // Soonest first, with name as the tiebreak so the order is stable across
  // reloads when several things expire on the same day.
  return sorted.sort(
    (a, b) =>
      a.days_until_expiry - b.days_until_expiry || a.name.localeCompare(b.name, 'es'),
  )
}
