import { LOCATION_LABELS, expiryPhrase, quantityLabel } from '@/labels'
import type { Product } from '@/services/types'

interface ProductCardProps {
  product: Product
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
}

/** One product row: what it is, how much, where, and how urgent. */
export function ProductCard({ product, onEdit, onDelete }: ProductCardProps) {
  return (
    <li className={`product-card product-card--${product.status}`}>
      <div className="product-card__main">
        <h2 className="product-card__name">{product.name}</h2>
        <p className="product-card__meta">
          {product.category ? <span>{product.category.name}</span> : <span className="product-card__uncategorised">Sin categoría</span>}
          <span aria-hidden="true">·</span>
          <span>{quantityLabel(product.quantity, product.unit)}</span>
          <span aria-hidden="true">·</span>
          <span>{LOCATION_LABELS[product.location]}</span>
        </p>
        {product.notes && <p className="product-card__notes">{product.notes}</p>}
      </div>

      <div className="product-card__side">
        <p className="product-card__expiry">
          <time dateTime={product.expires_at}>{expiryPhrase(product.days_until_expiry)}</time>
        </p>
        <div className="product-card__actions">
          <button
            type="button"
            className="button--icon"
            onClick={() => onEdit(product)}
            aria-label={`Editar ${product.name}`}
          >
            Editar
          </button>
          <button
            type="button"
            className="button--icon button--danger-text"
            onClick={() => onDelete(product)}
            aria-label={`Eliminar ${product.name}`}
          >
            Eliminar
          </button>
        </div>
      </div>
    </li>
  )
}
