import { useEffect, useState } from 'react'

import { Modal } from '@/components/Modal'
import { quantityLabel } from '@/labels'
import { addQuantities } from '@/quantity'
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

interface MonthGroup {
  key: string
  title: string
  products: Product[]
}

/** Newest month first, in the viewer's own calendar. The list arrives newest
 *  first already, so each month's rows are together. */
function groupByMonth(products: Product[]): MonthGroup[] {
  const groups: MonthGroup[] = []
  for (const product of products) {
    // Never null for a row from /products/history — see the backend endpoint.
    const date = new Date(product.consumed_at as string)
    const key = `${date.getFullYear()}-${date.getMonth()}`
    let group = groups.find((candidate) => candidate.key === key)
    if (!group) {
      const title = date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
      group = { key, title: title.charAt(0).toUpperCase() + title.slice(1), products: [] }
      groups.push(group)
    }
    group.products.push(product)
  }
  return groups
}

/** "2 consumidos · 1 se echó a perder", leaving out whichever is zero. */
function monthCounts(products: Product[]): string {
  const spoiled = products.filter((product) => product.spoiled).length
  const consumed = products.length - spoiled
  const parts = []
  if (consumed > 0) parts.push(consumed === 1 ? '1 consumido' : `${consumed} consumidos`)
  if (spoiled > 0) parts.push(spoiled === 1 ? '1 se echó a perder' : `${spoiled} se echaron a perder`)
  return parts.join(' · ')
}

/**
 * How a row left, when it takes more than the plain tag to say — see #172.
 *
 * `quantity` is what the last step took and `consumed_quantity` what was
 * eaten a part at a time before it, so a spoiled row with both was partly
 * eaten and partly thrown out. Numbers after a colon, not "4 consumidas":
 * no gender to get wrong for litros or piezas.
 */
function howItLeft(product: Product): string | null {
  if (!product.spoiled) return null
  if (Number(product.consumed_quantity) === 0) return 'Se echó a perder'
  const eaten = quantityLabel(product.consumed_quantity, null)
  const thrownOut = quantityLabel(product.quantity, null)
  return `Consumido: ${eaten} · Se echó a perder: ${thrownOut}`
}

/** Everything that has left the list, by month, eaten or thrown out, with a
 *  way to undo a mistaken tap. See #31 and #145. Each row shows the whole
 *  purchase, however many taps it took to finish it — see #172. */
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
    <Modal title="Historial" onClose={onClose}>
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
        <div className="product-history">
          {groupByMonth(products).map((group) => (
            <section key={group.key} className="product-history__month">
              <header className="product-history__month-header">
                <h3>{group.title}</h3>
                <p>{monthCounts(group.products)}</p>
              </header>
              <ul>
                {group.products.map((product) => {
                  const total = addQuantities(product.quantity, product.consumed_quantity)
                  const left = howItLeft(product)
                  return (
                    <li key={product.id} className="product-history__row">
                      <span className="product-history__icon" aria-hidden="true">
                        {product.icon}
                      </span>
                      <span className="product-history__details">
                        <span className="product-history__name">{product.name}</span>
                        <span className="product-history__meta">
                          {quantityLabel(total, product.unit)}
                          {product.consumed_at && ` · ${formatConsumedAt(product.consumed_at)}`}
                        </span>
                        {left && <span className="product-history__spoiled">{left}</span>}
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
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {restoreError && (
        <p className="form__error" role="alert">
          {restoreError}
        </p>
      )}
    </Modal>
  )
}
