import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { AddMenu } from '@/components/AddMenu'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { LabelQueueDialog } from '@/components/LabelQueueDialog'
import { ProductCard } from '@/components/ProductCard'
import { ProductFilters } from '@/components/ProductFilters'
import { ProductForm } from '@/components/ProductForm'
import { ProductHistory } from '@/components/ProductHistory'
import { ReceiptTripDialog } from '@/components/ReceiptTripDialog'
import { StaleBanner } from '@/components/StaleBanner'
import { UndoToast } from '@/components/UndoToast'
import { SettingsDialog } from '@/components/SettingsDialog'
import { downscaleImage } from '@/downscaleImage'
import {
  NO_FILTERS,
  applyFilters,
  hasActiveFilters,
  sortProducts,
  type ProductFilters as Filters,
  type SortKey,
} from '@/filters'
import { useCategories } from '@/hooks/useCategories'
import { useNameSuggestions } from '@/hooks/useNameSuggestions'
import { useProducts } from '@/hooks/useProducts'
import { apiUrl, toErrorMessage } from '@/services/api'
import { getCurrentLabelScans, queueLabelScan } from '@/services/labelScansService'
import { deleteProduct, restoreProduct } from '@/services/productsService'
import { getCurrentTrip, uploadReceipt } from '@/services/tripsService'
import type { LabelScan, Product, ShoppingTrip } from '@/services/types'

/** How often to check on photos still being read — a warm read takes a
 *  couple of seconds, a cold model load tens of them. */
const LABEL_POLL_MS = 3000

/** "2 leyendo, 3 por revisar" — only the parts that apply. */
function labelBannerText(scans: LabelScan[]): string {
  const reading = scans.filter((scan) => scan.status === 'pending').length
  const ready = scans.length - reading
  const parts = []
  if (reading > 0) parts.push(`${reading} leyendo`)
  if (ready > 0) parts.push(`${ready} por revisar`)
  return `Etiquetas: ${parts.join(', ')} — ${ready > 0 ? 'revisar' : 'ver'}`
}

/** What the screen is currently doing, beyond showing the list. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; product: Product }
  | { kind: 'delete'; product: Product }
  | { kind: 'settings' }
  | { kind: 'history' }
  | { kind: 'trip' }
  | { kind: 'labels' }

/** Main screen: everything in the house, soonest to expire first. */
export function ProductList() {
  const { products, loading, error, unreachable, cachedAt, reload, replaceProduct, removeProduct } = useProducts()
  const categories = useCategories()
  const nameSuggestions = useNameSuggestions()
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<SortKey>('expiry')

  const [currentTrip, setCurrentTrip] = useState<ShoppingTrip | null>(null)
  const [scanningReceipt, setScanningReceipt] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)

  const [labelScans, setLabelScans] = useState<LabelScan[]>([])
  const [uploadingLabels, setUploadingLabels] = useState<{ done: number; total: number } | null>(null)
  const [labelError, setLabelError] = useState<string | null>(null)
  const [lastConsumed, setLastConsumed] = useState<Product | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const labelsReading = labelScans.some((scan) => scan.status === 'pending')

  const visible = useMemo(
    () => sortProducts(applyFilters(products, filters), sort),
    [products, filters, sort],
  )

  // Resuming an unfinished trip is a "next visit" concern, not something a
  // reload of the active list itself would ever surface on its own — see
  // #84's own "an unfinished trip is still visible on the next visit".
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const trip = await getCurrentTrip()
        if (active) setCurrentTrip(trip)
      } catch {
        // Non-critical: the banner just does not show. A genuinely
        // unreachable backend is already covered by the product list's own
        // error state below.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const refreshLabelScans = useCallback(() => {
    // Non-critical, same as the trip banner: a failed check just leaves the
    // last known queue showing until the next one.
    getCurrentLabelScans()
      .then(setLabelScans)
      .catch(() => {})
  }, [])

  // Queued photos from a previous visit — see #134: the queue survives a
  // reload the same way an unfinished trip does.
  useEffect(() => {
    refreshLabelScans()
  }, [refreshLabelScans])

  // Only while something is still being read; nothing else about the queue
  // changes without this screen being the one that changed it. Paused while
  // the app is in the background — the camera app, typically, taking the
  // next photo — and caught up the moment it's back.
  useEffect(() => {
    if (!labelsReading) return
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refreshLabelScans()
    }
    const timer = window.setInterval(refreshIfVisible, LABEL_POLL_MS)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [labelsReading, refreshLabelScans])

  /** Uploads every chosen photo, one after another, then leaves the reading
   *  to the server — see #134. Nothing waits on the model here, so the list
   *  stays usable the whole time. */
  const handleLabelsSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // Cleared immediately, same as the receipt input.
    event.target.value = ''
    if (files.length === 0) return

    setLabelError(null)
    setUploadingLabels({ done: 0, total: files.length })
    void (async () => {
      let failed = 0
      for (const [index, file] of files.entries()) {
        try {
          await queueLabelScan(await downscaleImage(file))
          refreshLabelScans()
        } catch {
          failed += 1
        }
        setUploadingLabels({ done: index + 1, total: files.length })
      }
      if (failed > 0) {
        setLabelError(
          failed === 1 ? 'No se pudo subir 1 foto. Inténtalo de nuevo.' : `No se pudieron subir ${failed} fotos. Inténtalo de nuevo.`,
        )
      }
      setUploadingLabels(null)
    })()
  }

  /** Takes the row off the list and offers a way back — see #143: undoing
   *  a mistaken tap used to mean knowing to look in Historial. */
  const handleConsumed = (id: number) => {
    const consumed = products.find((product) => product.id === id)
    removeProduct(id)
    if (consumed) setLastConsumed(consumed)
  }

  const undoConsume = async (product: Product) => {
    await restoreProduct(product.id)
    reload()
  }

  const dismissUndo = useCallback(() => setLastConsumed(null), [])

  const handleLabelsChanged = () => {
    reload()
    refreshLabelScans()
  }

  const close = () => {
    setDialog({ kind: 'none' })
    setDeleteError(null)
  }

  const handleSaved = () => {
    close()
    reload()
  }

  const handleReceiptSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared immediately so scanning another receipt right after a
    // failure fires a change event the second time too.
    event.target.value = ''
    if (!file) return

    setScanningReceipt(true)
    setReceiptError(null)
    void (async () => {
      try {
        const trip = await uploadReceipt(await downscaleImage(file))
        setCurrentTrip(trip)
        setDialog({ kind: 'trip' })
      } catch (caught) {
        setReceiptError(toErrorMessage(caught))
      } finally {
        setScanningReceipt(false)
      }
    })()
  }

  // Refetched, not assumed from what the dialog already knows: the banner
  // and the active product list are both driven from here, so this is the
  // one place responsible for keeping either in sync after a drop or a
  // resolve, whether the trip dialog is still open or already closed.
  const handleTripChanged = () => {
    reload()
    void getCurrentTrip().then(setCurrentTrip)
  }

  const handleDelete = (product: Product) => {
    setDeleting(true)
    setDeleteError(null)
    void (async () => {
      try {
        await deleteProduct(product.id)
        close()
        reload()
      } catch (caught) {
        setDeleteError(toErrorMessage(caught))
      } finally {
        setDeleting(false)
      }
    })()
  }

  return (
    <>
      {/* Historial and Ajustes are navigation to a different view, not
          content-creation — visually distinct on purpose, as small icon
          buttons next to the title, so they stop competing with Recibo and
          Agregar producto for the same row and the same weight. That
          crowding is also what was cutting Historial off on a real phone
          before this. Emoji glyphs, not an icon font: matches how every
          product icon in this app already communicates meaning, and adds
          no new dependency for two buttons. */}
      <header className="app__header">
        <div className="app__header-top">
          <div>
            <h1>CaduTrack</h1>
            <p className="app__tagline">Lo que caduca primero, primero</p>
          </div>
          <div className="app__header-actions">
            <button
              type="button"
              className="app__icon-button"
              onClick={() => setDialog({ kind: 'history' })}
              aria-label="Historial"
            >
              <span aria-hidden="true">🕘</span>
            </button>
            <button
              type="button"
              className="app__icon-button"
              onClick={() => setDialog({ kind: 'settings' })}
              aria-label="Ajustes"
            >
              <span aria-hidden="true">⚙️</span>
            </button>
          </div>
        </div>
      </header>

      <div className="list-header">
        <AddMenu
          onManual={() => setDialog({ kind: 'create' })}
          onLabels={() => labelInputRef.current?.click()}
          onReceipt={() => receiptInputRef.current?.click()}
          labelsBusy={uploadingLabels !== null}
          receiptBusy={scanningReceipt}
        />
        {/* Hidden inputs driven by AddMenu's options — a real click on a
            hidden input rather than a wrapping <label>, same as ProductForm's
            photo buttons. Recibo keeps capture (straight to the camera, one
            shot); Varias etiquetas doesn't, so the picker also offers
            choosing several photos taken beforehand — see #134. */}
        <input
          ref={receiptInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleReceiptSelected}
          aria-label="Foto del recibo"
          hidden
        />
        <input
          ref={labelInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleLabelsSelected}
          aria-label="Fotos de etiquetas"
          hidden
        />
      </div>

      {(scanningReceipt || uploadingLabels) && (
        <p className="list-header__status" role="status">
          {scanningReceipt
            ? 'Leyendo recibo…'
            : uploadingLabels && `Subiendo etiquetas ${uploadingLabels.done + 1}/${uploadingLabels.total}…`}
        </p>
      )}

      {receiptError && (
        <p className="form__error" role="alert">
          {receiptError}
        </p>
      )}

      {labelError && (
        <p className="form__error" role="alert">
          {labelError}
        </p>
      )}

      {dialog.kind !== 'labels' && labelScans.length > 0 && (
        <button type="button" className="trip-banner" onClick={() => setDialog({ kind: 'labels' })}>
          {labelBannerText(labelScans)}
        </button>
      )}

      {dialog.kind !== 'trip' && currentTrip && currentTrip.items.some((item) => item.resolved_at === null) && (
        <button type="button" className="trip-banner" onClick={() => setDialog({ kind: 'trip' })}>
          Recibo pendiente: {currentTrip.items.filter((item) => item.resolved_at === null).length} producto
          {currentTrip.items.filter((item) => item.resolved_at === null).length === 1 ? '' : 's'} por revisar —
          continuar
        </button>
      )}

      {cachedAt && <StaleBanner cachedAt={cachedAt} />}

      {loading && <p className="state state--loading">Cargando…</p>}

      {!loading && error && (
        <div className="state state--error" role="alert">
          <p>{error}</p>
          {/* This bucket also covers a Cloudflare Access session expiring —
              see api.ts's isUnreachable — which otherwise fails the exact
              same way forever: a fetch can never complete Access's
              interactive login on its own, only a real top-level navigation
              to a protected URL can. Same-window on purpose, not a new tab:
              the PWA is the primary way this app is used, and an installed
              PWA typically has nowhere to open a second tab — this instead
              navigates away and back through /reauth, a small backend page
              that sends the browser straight back to "/" once Access lets
              the request through. Harmless when the real cause is just the
              server being down: the navigation fails to load, and the user
              is no worse off than before it existed. */}
          {unreachable && (
            <p className="state__hint">
              Si tu sesión expiró, <a href={apiUrl('/reauth')}>reautentícate aquí</a> — te regresa
              solo cuando termines.
            </p>
          )}
          <button type="button" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="state state--empty">
          <p>Todavía no hay nada registrado.</p>
          <p className="state__hint">Agrega tu primera compra para empezar a seguirle la pista.</p>
        </div>
      )}

      {!loading && !error && products.length > 0 && (
        <>
          <ProductFilters
            filters={filters}
            sort={sort}
            categories={categories}
            products={products}
            shown={visible.length}
            total={products.length}
            onChange={setFilters}
            onSortChange={setSort}
            onClear={() => setFilters(NO_FILTERS)}
          />

          {visible.length === 0 ? (
            // Distinct from the empty pantry above: the user has products, just
            // none matching. Telling them to "add their first purchase" here
            // would be wrong and confusing.
            <div className="state state--empty">
              <p>Ningún producto coincide con los filtros.</p>
              {hasActiveFilters(filters) && (
                <button type="button" onClick={() => setFilters(NO_FILTERS)}>
                  Quitar filtros
                </button>
              )}
            </div>
          ) : (
            <ul className="product-list">
              {visible.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onEdit={(target) => setDialog({ kind: 'edit', product: target })}
                  onDelete={(target) => setDialog({ kind: 'delete', product: target })}
                  onProductChanged={replaceProduct}
                  onConsumed={handleConsumed}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {dialog.kind === 'create' && (
        <ProductForm
          categories={categories}
          products={products}
          nameSuggestions={nameSuggestions}
          onSaved={handleSaved}
          onCancel={close}
        />
      )}

      {dialog.kind === 'edit' && (
        <ProductForm
          product={dialog.product}
          categories={categories}
          products={products}
          onSaved={handleSaved}
          onCancel={close}
        />
      )}

      {dialog.kind === 'settings' && <SettingsDialog onClose={close} onIconsReassigned={reload} />}

      {dialog.kind === 'history' && <ProductHistory onClose={close} onRestored={reload} />}

      {dialog.kind === 'trip' && currentTrip && (
        <ReceiptTripDialog
          trip={currentTrip}
          categories={categories}
          products={products}
          nameSuggestions={nameSuggestions}
          onClose={close}
          onTripChanged={handleTripChanged}
        />
      )}

      {lastConsumed && (
        <UndoToast
          key={lastConsumed.id}
          // Name last, not "X marcado como…": no agreement to get wrong for
          // a feminine or plural name.
          message={`Consumido: ${lastConsumed.name}`}
          onUndo={() => undoConsume(lastConsumed)}
          onDismiss={dismissUndo}
        />
      )}

      {dialog.kind === 'labels' && (
        <LabelQueueDialog
          scans={labelScans}
          categories={categories}
          products={products}
          nameSuggestions={nameSuggestions}
          onClose={close}
          onChanged={handleLabelsChanged}
        />
      )}

      {dialog.kind === 'delete' && (
        <ConfirmDialog
          title="Eliminar producto"
          message={
            deleteError ??
            `¿Seguro que quieres eliminar "${dialog.product.name}"? Esta acción no se puede deshacer.`
          }
          confirmLabel="Eliminar"
          busy={deleting}
          onConfirm={() => handleDelete(dialog.product)}
          onCancel={close}
        />
      )}
    </>
  )
}
