import { useState } from 'react'

import { IconPicker } from '@/components/IconPicker'
import { LOCATION_LABELS, expiryPhrase, quantityLabel } from '@/labels'
import { canStepDown } from '@/quantity'
import { toErrorMessage } from '@/services/api'
import { adjustProductQuantity, consumeProduct, setProductIcon } from '@/services/productsService'
import type { Product } from '@/services/types'

interface ProductCardProps {
  product: Product
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  /** Called with the server's own response after a successful quantity tap or
   *  icon change, so the list can update that one row without a full reload. */
  onProductChanged: (updated: Product) => void
  /** Called with the id after a successful consume — the row leaves the
   *  active list entirely rather than being updated in place. */
  onConsumed: (id: number) => void
}

/** One product row: what it is, how much, where, and how urgent. */
export function ProductCard({ product, onEdit, onDelete, onProductChanged, onConsumed }: ProductCardProps) {
  const [adjustingQuantity, setAdjustingQuantity] = useState(false)
  const [quantityError, setQuantityError] = useState<string | null>(null)

  const [editingIcon, setEditingIcon] = useState(false)
  const [savingIcon, setSavingIcon] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)

  const [consuming, setConsuming] = useState(false)
  const [consumeError, setConsumeError] = useState<string | null>(null)

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
    setEditingIcon(true)
  }

  // Called only with a value already checked to be worth saving — see
  // IconPicker, which never calls this for a no-op selection.
  const commitIcon = (icon: string) => {
    setSavingIcon(true)
    setIconError(null)
    void (async () => {
      try {
        onProductChanged(await setProductIcon(product.id, icon))
        setEditingIcon(false)
      } catch (caught) {
        setIconError(toErrorMessage(caught))
      } finally {
        setSavingIcon(false)
      }
    })()
  }

  const handleConsume = () => {
    setConsuming(true)
    setConsumeError(null)
    void (async () => {
      try {
        await consumeProduct(product.id)
        onConsumed(product.id)
      } catch (caught) {
        setConsumeError(toErrorMessage(caught))
      } finally {
        setConsuming(false)
      }
    })()
  }

  return (
    <li className={`product-card product-card--${product.status}`}>
      <div className="product-card__main">
        <h2 className="product-card__name">
          <button
            type="button"
            className="product-card__icon-button"
            onClick={startEditingIcon}
            aria-label={`Cambiar icono de ${product.name}, actualmente ${product.icon}`}
          >
            {product.icon}
          </button>
          {/* Its own element so a caller can read the name without the icon
              prefix mixed into textContent — see ProductList.test.tsx's
              headingNames() helper. */}
          <span className="product-card__name-text">{product.name}</span>
        </h2>

        {editingIcon && (
          <IconPicker
            value={product.icon}
            busy={savingIcon}
            onSelect={commitIcon}
            onCancel={() => setEditingIcon(false)}
            label={`Cambiar icono de ${product.name}`}
          />
        )}

        <p className="product-card__meta">
          {product.category ? <span>{product.category.name}</span> : <span className="product-card__uncategorised">Sin categoría</span>}
          <span aria-hidden="true">·</span>
          <span className="quantity-stepper">
            {/* Hidden rather than disabled at quantity 1 — a stepper that is
                half-buttons for most of the list (single-item products are
                common) reads as cluttered for no benefit, since the button
                does nothing there either way. */}
            {canStepDown(product.quantity) && (
              <button
                type="button"
                className="quantity-stepper__button"
                onClick={() => adjustQuantity(-1)}
                disabled={adjustingQuantity}
                aria-label={`Reducir cantidad de ${product.name}`}
              >
                −
              </button>
            )}
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
        {consumeError && (
          <p className="product-card__quantity-error" role="alert">
            {consumeError}
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
            onClick={handleConsume}
            disabled={consuming}
            aria-label={`Marcar ${product.name} como consumido`}
          >
            {consuming ? 'Marcando…' : 'Consumido'}
          </button>
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
