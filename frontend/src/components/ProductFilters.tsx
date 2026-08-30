import { LOCATION_LABELS, STATUS_LABELS } from '@/labels'
import type { ProductFilters as Filters, SortKey } from '@/filters'
import { hasActiveFilters } from '@/filters'
import type { Category, ExpiryStatus, Location } from '@/services/types'

interface ProductFiltersProps {
  filters: Filters
  sort: SortKey
  categories: Category[]
  /** Products matching the current filters, for the result count. */
  shown: number
  total: number
  onChange: (filters: Filters) => void
  onSortChange: (sort: SortKey) => void
  onClear: () => void
}

/** Filter and sort controls for the product list. */
export function ProductFilters({
  filters,
  sort,
  categories,
  shown,
  total,
  onChange,
  onSortChange,
  onClear,
}: ProductFiltersProps) {
  const active = hasActiveFilters(filters)

  return (
    <section className="filters" aria-label="Filtros">
      <div className="filters__controls">
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
          <span>Ubicación</span>
          <select
            value={filters.location}
            onChange={(event) =>
              onChange({ ...filters, location: event.target.value as Location | 'all' })
            }
          >
            <option value="all">Todas</option>
            {Object.entries(LOCATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="filters__field">
          <span>Estado</span>
          <select
            value={filters.status}
            onChange={(event) =>
              onChange({ ...filters, status: event.target.value as ExpiryStatus | 'all' })
            }
          >
            <option value="all">Todos</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
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
