import { LOCATION_LABELS, expiryPhrase, quantityLabel } from '@/labels'
import type { Product } from '@/services/types'

interface ProductCardProps {
  product: Product
}

/** One product row: what it is, how much, where, and how urgent. */
export function ProductCard({ product }: ProductCardProps) {
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
      <p className="product-card__expiry">
        <time dateTime={product.expires_at}>{expiryPhrase(product.days_until_expiry)}</time>
      </p>
    </li>
  )
}
