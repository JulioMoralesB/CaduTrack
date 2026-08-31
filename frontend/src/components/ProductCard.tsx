import { useState, type KeyboardEvent } from 'react'

import { LOCATION_LABELS, expiryPhrase, quantityLabel } from '@/labels'
import { canStepDown } from '@/quantity'
import { toErrorMessage } from '@/services/api'
import { adjustProductQuantity, setProductIcon } from '@/services/productsService'
import type { Product } from '@/services/types'

interface ProductCardProps {
  product: Product
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  /** Called with the server's own response after a successful quantity tap or
   *  icon change, so the list can update that one row without a full reload. */
  onProductChanged: (updated: Product) => void
}

/** One product row: what it is, how much, where, and how urgent. */
export function ProductCard({ product, onEdit, onDelete, onProductChanged }: ProductCardProps) {
  const [adjustingQuantity, setAdjustingQuantity] = useState(false)
  const [quantityError, setQuantityError] = useState<string | null>(null)

  const [editingIcon, setEditingIcon] = useState(false)
  const [iconDraft, setIconDraft] = useState('')
  const [savingIcon, setSavingIcon] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)

  const adjustQuantity = (delta: 1 | -1) => {
    setAdjustingQuantity(true)
    setQuantityError(null)
    void (async () => {
      try {
        onProductChanged(await adjustProductQuantity(product.id, delta))
      } catch (caught) {
        setQuantityError(toErrorMessage(caught))
      } finally {
        setAdjustingQuantity(false)
      }
    })()
  }

  const startEditingIcon = () => {
    setIconError(null)
    setIconDraft(product.icon)
    setEditingIcon(true)
  }

  // A blank field or the icon unchanged means "never mind" — nothing to save,
  // and no reason to spend a request confirming the current value.
  const commitIcon = () => {
    const next = iconDraft.trim()
    if (next === '' || next === product.icon) {
      setEditingIcon(false)
      return
    }

    setSavingIcon(true)
    setIconError(null)
    void (async () => {
      try {
        onProductChanged(await setProductIcon(product.id, next))
        setEditingIcon(false)
      } catch (caught) {
        setIconError(toErrorMessage(caught))
      } finally {
        setSavingIcon(false)
      }
    })()
  }

  const handleIconKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commitIcon()
    if (event.key === 'Escape') setEditingIcon(false)
  }

  return (
    <li className={`product-card product-card--${product.status}`}>
      <div className="product-card__main">
        <h2 className="product-card__name">
          {editingIcon ? (
            <input
              type="text"
              className="product-card__icon-input"
              value={iconDraft}
              onChange={(event) => setIconDraft(event.target.value)}
              onBlur={commitIcon}
              onKeyDown={handleIconKeyDown}
              disabled={savingIcon}
              maxLength={16}
              autoFocus
              aria-label={`Cambiar icono de ${product.name}`}
            />
          ) : (
            <button
              type="button"
              className="product-card__icon-button"
              onClick={startEditingIcon}
              aria-label={`Cambiar icono de ${product.name}, actualmente ${product.icon}`}
            >
              {product.icon}
            </button>
          )}
          {/* Its own element so a caller can read the name without the icon
              prefix mixed into textContent — see ProductList.test.tsx's
              headingNames() helper. */}
          <span className="product-card__name-text">{product.name}</span>
        </h2>
        <p className="product-card__meta">
          {product.category ? <span>{product.category.name}</span> : <span className="product-card__uncategorised">Sin categoría</span>}
          <span aria-hidden="true">·</span>
          <span className="quantity-stepper">
            <button
              type="button"
              className="quantity-stepper__button"
              onClick={() => adjustQuantity(-1)}
              disabled={adjustingQuantity || !canStepDown(product.quantity)}
              aria-label={`Reducir cantidad de ${product.name}`}
            >
              −
            </button>
            <span className="quantity-stepper__value">{quantityLabel(product.quantity, product.unit)}</span>
            <button
              type="button"
              className="quantity-stepper__button"
              onClick={() => adjustQuantity(1)}
              disabled={adjustingQuantity}
              aria-label={`Aumentar cantidad de ${product.name}`}
            >
              +
            </button>
          </span>
          <span aria-hidden="true">·</span>
          <span>{LOCATION_LABELS[product.location]}</span>
        </p>
        {quantityError && (
          <p className="product-card__quantity-error" role="alert">
            {quantityError}
          </p>
        )}
        {iconError && (
          <p className="product-card__quantity-error" role="alert">
            {iconError}
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
