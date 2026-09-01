import { useEffect, useState } from 'react'

import { Modal } from '@/components/Modal'
import { quantityLabel } from '@/labels'
import { toErrorMessage } from '@/services/api'
import { listConsumedProducts, restoreProduct } from '@/services/productsService'
import type { Product } from '@/services/types'

interface ProductHistoryProps {
  onClose: () => void
  /** Called after a successful restore, so the active list behind this dialog
   *  picks up the returning product instead of showing a stale list until
   *  something else triggers a reload — same pattern as SettingsDialog's
   *  onIconsReassigned. */
  onRestored: () => void
}

/**
 * When a product was consumed, in the viewer's own local time.
 *
 * Unlike SettingsDialog's next-alert time, which means server time and must
 * stay in the server's zone to match the hour picker next to it, this
 * timestamp records the moment the viewer tapped a button on their own
 * device — their own zone is the correct one to show it in.
 */
function formatConsumedAt(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** History of consumed products, with a way to undo a mistaken tap. See #31. */
export function ProductHistory({ onClose, onRestored }: ProductHistoryProps) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const data = await listConsumedProducts()
        if (active) setProducts(data)
      } catch (caught) {
        if (active) setError(toErrorMessage(caught))
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const handleRestore = (product: Product) => {
    setRestoringId(product.id)
    setRestoreError(null)
    void (async () => {
      try {
        await restoreProduct(product.id)
        setProducts((current) => current?.filter((candidate) => candidate.id !== product.id) ?? null)
        onRestored()
      } catch (caught) {
        setRestoreError(toErrorMessage(caught))
      } finally {
        setRestoringId(null)
      }
    })()
  }

  return (
    <Modal title="Historial de consumidos" onClose={onClose}>
      {products === null && !error && <p className="state state--loading">Cargando…</p>}

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      {products !== null && products.length === 0 && (
        <p className="state state--empty">Todavía no has marcado nada como consumido.</p>
      )}

      {products !== null && products.length > 0 && (
        <ul className="product-history">
          {products.map((product) => (
            <li key={product.id} className="product-history__row">
              <span className="product-history__icon" aria-hidden="true">
                {product.icon}
              </span>
              <span className="product-history__details">
                <span className="product-history__name">{product.name}</span>
                <span className="product-history__meta">
                  {quantityLabel(product.quantity, product.unit)}
                  {/* consumed_at is never null for a row returned by
                      /products/history — see the backend endpoint. */}
                  {product.consumed_at && ` · ${formatConsumedAt(product.consumed_at)}`}
                </span>
              </span>
              <button
                type="button"
                className="button--icon"
                onClick={() => handleRestore(product)}
                disabled={restoringId === product.id}
                aria-label={`Restaurar ${product.name}`}
              >
                {restoringId === product.id ? 'Restaurando…' : 'Restaurar'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {restoreError && (
        <p className="form__error" role="alert">
          {restoreError}
        </p>
      )}
    </Modal>
  )
}
