import { useState } from 'react'

import { LOCATION_LABELS } from '@/labels'
import type { ProductFilters as Filters, SortKey } from '@/filters'
import { hasActiveFilters } from '@/filters'
import type { Category, ExpiryStatus, Location, Product } from '@/services/types'

interface ProductFiltersProps {
  filters: Filters
  sort: SortKey
  categories: Category[]
  /** Every active product, unfiltered — the status chips count from it, so
   *  "Vencidos 2" still says 2 while another filter is narrowing the list. */
  products: Product[]
  /** Products matching the current filters, for the result count. */
  shown: number
  total: number
  onChange: (filters: Filters) => void
  onSortChange: (sort: SortKey) => void
  onClear: () => void
}

/** The two statuses worth a chip: the ones that need doing something about. */
const STATUS_CHIPS: { status: ExpiryStatus; label: string }[] = [
  { status: 'expired', label: 'Vencidos' },
  { status: 'expiring_soon', label: 'Por caducar' },
]

/**
 * Search, filter and sort controls for the product list — see #141.
 *
 * One row of chips instead of four always-open selects: the status chips
 * double as the summary ("Vencidos 2"), and the rarer controls — category,
 * sort order — wait behind "Más filtros".
 */
export function ProductFilters({
  filters,
  sort,
  categories,
  products,
  shown,
  total,
  onChange,
  onSortChange,
  onClear,
}: ProductFiltersProps) {
  // Open from the start if one of its own controls is already in use, so an
  // active filter is never hidden.
  const [moreOpen, setMoreOpen] = useState(filters.categoryId !== 'all' || sort !== 'expiry')
  const active = hasActiveFilters(filters)

  const countByStatus = (status: ExpiryStatus) => products.filter((product) => product.status === status).length

  const toggleStatus = (status: ExpiryStatus) =>
    onChange({ ...filters, status: filters.status === status ? 'all' : status })

  const toggleLocation = (location: Location) =>
    onChange({ ...filters, location: filters.location === location ? 'all' : location })

  return (
    <section className="filters" aria-label="Filtros">
      <input
        type="search"
        className="filters__search"
        value={filters.query}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
        placeholder="Buscar producto…"
        aria-label="Buscar producto"
        enterKeyHint="search"
      />

      <div className="filters__chips">
        {STATUS_CHIPS.map(({ status, label }) => {
          const count = countByStatus(status)
          return (
            <button
              key={status}
              type="button"
              className={`chip chip--${status}`}
              aria-pressed={filters.status === status}
              aria-label={count > 0 ? `${label}, ${count}` : label}
              onClick={() => toggleStatus(status)}
            >
              {label}
              {count > 0 && (
                <span className="chip__count" aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
          )
        })}
        {(Object.entries(LOCATION_LABELS) as [Location, string][]).map(([location, label]) => (
          <button
            key={location}
            type="button"
            className="chip"
            aria-pressed={filters.location === location}
            onClick={() => toggleLocation(location)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="chip chip--more"
          aria-expanded={moreOpen}
          aria-controls="filters-more"
          onClick={() => setMoreOpen((open) => !open)}
        >
          Más filtros
        </button>
      </div>

      {moreOpen && (
        <div id="filters-more" className="filters__controls">
          <label className="filters__field">
            <span>Categoría</span>
            <select
              value={filters.categoryId === 'all' ? 'all' : String(filters.categoryId)}
              onChange={(event) =>
                onChange({
                  ...filters,
                  categoryId: event.target.value === 'all' ? 'all' : Number(event.target.value),
                })
              }
            >
              <option value="all">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="filters__field">
            <span>Ordenar por</span>
            <select value={sort} onChange={(event) => onSortChange(event.target.value as SortKey)}>
              <option value="expiry">Caducidad</option>
              <option value="name">Nombre</option>
            </select>
          </label>
        </div>
      )}

      {active && (
        <div className="filters__summary">
          <span>
            {shown} de {total}
          </span>
          <button type="button" className="button--icon" onClick={onClear}>
            Quitar filtros
          </button>
        </div>
      )}
    </section>
  )
}
