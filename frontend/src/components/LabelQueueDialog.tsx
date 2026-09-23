import { useState } from 'react'

import { Modal } from '@/components/Modal'
import { ProductForm, type ProductPrefill } from '@/components/ProductForm'
import { quantityLabel } from '@/labels'
import { toErrorMessage } from '@/services/api'
import { dropLabelScan, labelScanImageUrl, resolveLabelScan, retryLabelScan } from '@/services/labelScansService'
import type { Category, LabelScan, Product, ProductNameSuggestion } from '@/services/types'

interface LabelQueueDialogProps {
  /** The live queue, polled by the caller — not copied into state here, so
   *  a photo finishing its read while this is open shows up right away. */
  scans: LabelScan[]
  categories: Category[]
  products: Product[]
  nameSuggestions?: ProductNameSuggestion[]
  onClose: () => void
  /** Called after any resolve, drop, or retry, so the caller refetches the
   *  queue and the product list together. */
  onChanged: () => void
}

/** "Caduca 12 oct 2026" — the date itself rather than "en 10 días": the
 *  point of showing it here is checking the model read the right one. */
function expiryText(expiresAt: string): string {
  const [year, month, day] = expiresAt.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return `Caduca ${date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function prefillFor(scan: LabelScan): ProductPrefill {
  return {
    name: scan.name ?? undefined,
    quantity: scan.quantity ?? undefined,
    expires_at: scan.expires_at ?? undefined,
    unit: scan.unit ?? undefined,
  }
}

/**
 * The queued label photos — see #134. Same two phases as
 * ReceiptTripDialog: review the list, then walk through the photos to add
 * one ProductForm at a time, each prefilled with whatever its label read.
 *
 * Photos keep being read while this is open or closed; nothing here waits
 * on the model.
 */
export function LabelQueueDialog({
  scans,
  categories,
  products,
  nameSuggestions,
  onClose,
  onChanged,
}: LabelQueueDialogProps) {
  // Ids rather than scans, so the form always shows the live copy.
  const [queue, setQueue] = useState<number[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const readScans = scans.filter((scan) => scan.status === 'read')
  const stillReading = scans.some((scan) => scan.status === 'pending')

  const runAction = (scan: LabelScan, action: (scanId: number) => Promise<LabelScan>) => {
    setBusy(scan.id)
    setError(null)
    void (async () => {
      try {
        await action(scan.id)
        onChanged()
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setBusy(null)
      }
    })()
  }

  // A photo resolved or dropped since the walk started (this walk's own
  // previous step, or anywhere else) just isn't in the live list any more —
  // skipped, not an error.
  const liveQueue = queue?.filter((id) => scans.some((scan) => scan.id === id)) ?? []
  const current = scans.find((scan) => scan.id === liveQueue[0])

  const skip = (scanId: number) => setQueue((ids) => (ids ? ids.filter((id) => id !== scanId) : ids))

  const handleSaved = (product: Product) => {
    if (!current) return
    void (async () => {
      try {
        await resolveLabelScan(current.id, product.id)
        onChanged()
        skip(current.id)
      } catch (caught) {
        // Same as ReceiptTripDialog: the product exists, only the link
        // failed — back to the list, where the error is actually visible.
        setError(toErrorMessage(caught))
        setQueue(null)
      }
    })()
  }

  if (current !== undefined) {
    return (
      // Keyed per scan: ProductForm only reads prefill on mount — see
      // ReceiptTripDialog's own note on the same key.
      <ProductForm
        key={current.id}
        categories={categories}
        products={products}
        nameSuggestions={nameSuggestions}
        prefill={prefillFor(current)}
        title={liveQueue.length === 1 ? 'Agregar producto' : `Agregar producto (quedan ${liveQueue.length})`}
        onSaved={handleSaved}
        onCancel={() => skip(current.id)}
      />
    )
  }

  return (
    <Modal title="Etiquetas" onClose={onClose}>
      {scans.length === 0 ? (
        <p className="state state--empty">Ya no quedan etiquetas por revisar.</p>
      ) : (
        <ul className="trip-checklist">
          {scans.map((scan) => (
            <li key={scan.id} className="trip-checklist__row label-queue__row">
              <img className="label-queue__thumb" src={labelScanImageUrl(scan.id)} alt="" loading="lazy" />
              <div className="label-queue__body">
                <span className="trip-checklist__name">
                  {scan.status === 'pending'
                    ? 'Leyendo…'
                    : scan.status === 'failed'
                      ? 'No se pudo leer'
                      : (scan.name ?? 'Sin nombre legible')}
                </span>
                {scan.status === 'read' && (scan.expires_at || scan.quantity) && (
                  <span className="label-queue__detail">
                    {[scan.expires_at && expiryText(scan.expires_at), scan.quantity && quantityLabel(scan.quantity, scan.unit)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
                <div className="label-queue__actions">
                  {scan.status !== 'pending' && (
                    <button
                      type="button"
                      className="trip-checklist__link-button"
                      onClick={() => setQueue([scan.id])}
                      disabled={busy === scan.id}
                      aria-label={`Agregar ${scan.name ?? `foto ${scan.id}`}`}
                    >
                      Agregar
                    </button>
                  )}
                  {scan.status === 'failed' && (
                    <button
                      type="button"
                      className="trip-checklist__link-button"
                      onClick={() => runAction(scan, retryLabelScan)}
                      disabled={busy === scan.id}
                    >
                      Reintentar
                    </button>
                  )}
                  <button
                    type="button"
                    className="trip-checklist__link-button"
                    onClick={() => runAction(scan, dropLabelScan)}
                    disabled={busy === scan.id}
                    aria-label={`Descartar ${scan.name ?? `foto ${scan.id}`}`}
                  >
                    Descartar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {stillReading && (
        <p className="state__hint">Puedes cerrar esta ventana y seguir usando la app — las fotos se siguen leyendo.</p>
      )}

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <div className="form__actions">
        {/* Not "Cerrar": the modal's own × already carries that name. */}
        <button type="button" onClick={onClose}>
          Listo
        </button>
        {readScans.length > 1 && (
          <button
            type="button"
            className="button--primary"
            onClick={() => setQueue(readScans.map((scan) => scan.id))}
          >
            Agregar las {readScans.length} leídas
          </button>
        )}
      </div>
    </Modal>
  )
}
