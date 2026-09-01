import { useState } from 'react'

import { Modal } from '@/components/Modal'
import { ProductForm } from '@/components/ProductForm'
import { quantityLabel } from '@/labels'
import { toErrorMessage } from '@/services/api'
import { dropTripItem, resolveTripItem } from '@/services/tripsService'
import type { Category, Product, ShoppingTrip, ShoppingTripItem } from '@/services/types'

interface ReceiptTripDialogProps {
  trip: ShoppingTrip
  categories: Category[]
  onClose: () => void
  /** Called whenever an item is dropped or resolved, so the active product
   *  list and the "current trip" banner stay in sync without a second
   *  request driving both independently. */
  onTripChanged: () => void
}

/** Where the item currently sits in the checklist: unresolved (its tick
 *  reflects the model's own is_food guess until the user overrides it),
 *  dropped, or resolved into a product. */
type ItemState = 'pending' | 'dropped' | 'added'

function itemState(item: ShoppingTripItem): ItemState {
  if (item.resolved_at === null) return 'pending'
  return item.product_id === null ? 'dropped' : 'added'
}

/**
 * A receipt's checklist: review what was read, tick or untick each line,
 * then walk through the ticked ones one at a time — each needs its own
 * date, which a shared bulk form cannot give it — via the same ProductForm
 * used everywhere else. See #84.
 *
 * Two phases, not one screen: "review" lets the whole list be corrected
 * before anything is committed; "adding" commits one line at a time,
 * because #83's own photo-of-the-label scan is exactly what a user reaches
 * for here, and that only makes sense pointed at a single product.
 */
export function ReceiptTripDialog({ trip, categories, onClose, onTripChanged }: ReceiptTripDialogProps) {
  const [items, setItems] = useState(trip.items)
  // Only the pending items need a tick; a dropped or added item does not
  // come back to this map even if a later action revisits it.
  const [ticked, setTicked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(trip.items.filter((item) => item.resolved_at === null).map((item) => [item.id, item.is_food])),
  )
  const [queue, setQueue] = useState<ShoppingTripItem[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = items.filter((item) => itemState(item) === 'pending')

  const toggle = (itemId: number) =>
    setTicked((current) => ({ ...current, [itemId]: !current[itemId] }))

  const replaceItem = (updated: ShoppingTripItem) =>
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))

  /** Drops every unticked line, then starts walking through the ticked
   *  ones — see the module docstring for why adding is sequential. */
  const handleContinue = () => {
    setSubmitting(true)
    setError(null)
    void (async () => {
      try {
        const toDrop = pending.filter((item) => !ticked[item.id])
        const dropped = await Promise.all(toDrop.map((item) => dropTripItem(trip.id, item.id)))
        dropped.forEach(replaceItem)
        if (dropped.length > 0) onTripChanged()

        const toAdd = pending.filter((item) => ticked[item.id])
        setQueue(toAdd)
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setSubmitting(false)
      }
    })()
  }

  /** After a product is created for the item at the front of the queue,
   *  resolved or not — advancing must not get stuck on one line the user
   *  can no longer act on. */
  const advanceQueue = () => setQueue((current) => (current ? current.slice(1) : current))

  const handleItemSaved = (product: Product) => {
    if (!queue || queue.length === 0) return
    const current = queue[0]
    void (async () => {
      try {
        const resolved = await resolveTripItem(trip.id, current.id, product.id)
        replaceItem(resolved)
        onTripChanged()
        advanceQueue()
      } catch (caught) {
        // The product itself was already created successfully — only the
        // bookkeeping link failed. The review screen's error banner is the
        // only place in this dialog visible regardless of which item comes
        // next, so this drops back to it instead of silently advancing to
        // the next item's form, where nothing would ever render this at
        // all — see #84's own "say so instead of silently dropping a line"
        // for why that matters here too. The item stays ticked, since the
        // user's own choice to add it has not changed, only this attempt.
        setError(toErrorMessage(caught))
        setQueue(null)
      }
    })()
  }

  if (queue !== null && queue.length > 0) {
    const current = queue[0]
    const remaining = queue.length
    return (
      // Keyed on the item's own id, not left to reconciliation: ProductForm
      // seeds its editable state from `prefill` exactly once, on mount, the
      // same as it does from `product` — without a key that ties each
      // queue item to its own instance, advancing the queue would change
      // the prop but reuse the already-mounted component, leaving the
      // previous item's name showing under a new one. Reproduced directly.
      <ProductForm
        key={current.id}
        categories={categories}
        prefill={{ name: current.name, quantity: current.quantity }}
        title={remaining === 1 ? 'Agregar producto' : `Agregar producto (quedan ${remaining})`}
        onSaved={handleItemSaved}
        onCancel={advanceQueue}
      />
    )
  }

  if (queue !== null) {
    // The queue ran out — everything ticked has been either added or
    // skipped. Skipped items are still pending, so pending.length here
    // only reaches 0 when every line was truly dealt with.
    return (
      <Modal title="Recibo" onClose={onClose}>
        <p className="state state--empty">
          {pending.length === 0
            ? 'Listo — se procesó todo el recibo.'
            : 'Los productos que agregaste ya están en tu lista. Los que dejaste pendientes seguirán apareciendo aquí.'}
        </p>
        <div className="form__actions">
          {/* Not "Cerrar": the modal's own × close button already carries
              that label, and two controls sharing one accessible name is
              exactly the kind of thing a screen reader user cannot tell
              apart. */}
          <button type="button" className="button--primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Recibo" onClose={onClose}>
      {trip.reconciled === false && (
        <p className="form__error" role="alert">
          La suma de cantidades ({trip.counted_quantity}) no coincide con el total del recibo (
          {trip.stated_item_count}) — puede que falte un producto por revisar.
        </p>
      )}

      {pending.length === 0 ? (
        <p className="state state--empty">Ya no quedan productos pendientes en este recibo.</p>
      ) : (
        <ul className="trip-checklist">
          {pending.map((item) => (
            <li key={item.id} className="trip-checklist__row">
              <label className="trip-checklist__label">
                <input
                  type="checkbox"
                  checked={ticked[item.id] ?? item.is_food}
                  onChange={() => toggle(item.id)}
                />
                <span className="trip-checklist__name">{item.name}</span>
              </label>
              <span className="trip-checklist__quantity">{quantityLabel(item.quantity, null)}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <div className="form__actions">
        {/* "Cancelar", not "Cerrar": the modal's own × close button already
            carries that label — see the done screen's own note. */}
        <button type="button" onClick={onClose} disabled={submitting}>
          Cancelar
        </button>
        {pending.length > 0 && (
          <button type="button" className="button--primary" onClick={handleContinue} disabled={submitting}>
            {submitting ? 'Procesando…' : 'Continuar'}
          </button>
        )}
      </div>
    </Modal>
  )
}
