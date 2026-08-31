import { useState } from 'react'

import { LOCATION_LABELS, expiryPhrase, quantityLabel } from '@/labels'
import { canStepDown } from '@/quantity'
import { toErrorMessage } from '@/services/api'
import { adjustProductQuantity } from '@/services/productsService'
import type { Product } from '@/services/types'

interface ProductCardProps {
  product: Product
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  /** Called with the server's own response after a successful +/- tap, so the
   *  list can update that one row without a full reload. */
  onQuantityChanged: (updated: Product) => void
}

/** One product row: what it is, how much, where, and how urgent. */
export function ProductCard({ product, onEdit, onDelete, onQuantityChanged }: ProductCardProps) {
  const [adjusting, setAdjusting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const adjust = (delta: 1 | -1) => {
    setAdjusting(true)
    setError(null)
    void (async () => {
      try {
        onQuantityChanged(await adjustProductQuantity(product.id, delta))
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setAdjusting(false)
      }
    })()
  }

  return (
    <li className={`product-card product-card--${product.status}`}>
      <div className="product-card__main">
        <h2 className="product-card__name">{product.name}</h2>
        <p className="product-card__meta">
          {product.category ? <span>{product.category.name}</span> : <span className="product-card__uncategorised">Sin categoría</span>}
          <span aria-hidden="true">·</span>
          <span className="quantity-stepper">
            <button
              type="button"
              className="quantity-stepper__button"
              onClick={() => adjust(-1)}
              disabled={adjusting || !canStepDown(product.quantity)}
              aria-label={`Reducir cantidad de ${product.name}`}
            >
              −
            </button>
            <span className="quantity-stepper__value">{quantityLabel(product.quantity, product.unit)}</span>
            <button
              type="button"
              className="quantity-stepper__button"
              onClick={() => adjust(1)}
              disabled={adjusting}
              aria-label={`Aumentar cantidad de ${product.name}`}
            >
              +
            </button>
          </span>
          <span aria-hidden="true">·</span>
          <span>{LOCATION_LABELS[product.location]}</span>
        </p>
        {error && (
          <p className="product-card__quantity-error" role="alert">
            {error}
          </p>
        )}
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
