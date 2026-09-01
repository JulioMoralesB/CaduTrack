import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ProductCard } from '@/components/ProductCard'
import { ProductFilters } from '@/components/ProductFilters'
import { ProductForm } from '@/components/ProductForm'
import { ProductHistory } from '@/components/ProductHistory'
import { ReceiptTripDialog } from '@/components/ReceiptTripDialog'
import { StaleBanner } from '@/components/StaleBanner'
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
import { useProducts } from '@/hooks/useProducts'
import { apiUrl, toErrorMessage } from '@/services/api'
import { deleteProduct } from '@/services/productsService'
import { getCurrentTrip, uploadReceipt } from '@/services/tripsService'
import type { Product, ShoppingTrip } from '@/services/types'

/** What the screen is currently doing, beyond showing the list. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; product: Product }
  | { kind: 'delete'; product: Product }
  | { kind: 'settings' }
  | { kind: 'history' }
  | { kind: 'trip' }

/** Main screen: everything in the house, soonest to expire first. */
export function ProductList() {
  const { products, loading, error, unreachable, cachedAt, reload, replaceProduct, removeProduct } = useProducts()
  const categories = useCategories()
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<SortKey>('expiry')

  const [currentTrip, setCurrentTrip] = useState<ShoppingTrip | null>(null)
  const [scanningReceipt, setScanningReceipt] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)

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
      <div className="list-header">
        <button type="button" onClick={() => setDialog({ kind: 'history' })}>
          Historial
        </button>
        <button type="button" onClick={() => setDialog({ kind: 'settings' })}>
          Ajustes
        </button>
        {/* A real click on a hidden input, not a wrapping <label>: the label
            text here would otherwise absorb "Leyendo…" into its own
            accessible name while a scan is in flight — see #83's own note
            on ProductForm for the exact same fix, same reason. */}
        <button
          type="button"
          onClick={() => receiptInputRef.current?.click()}
          disabled={scanningReceipt}
        >
          {scanningReceipt ? 'Leyendo…' : 'Recibo'}
        </button>
        <input
          ref={receiptInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleReceiptSelected}
          hidden
        />
        <button
          type="button"
          className="button--primary"
          onClick={() => setDialog({ kind: 'create' })}
        >
          Agregar producto
        </button>
      </div>

      {receiptError && (
        <p className="form__error" role="alert">
          {receiptError}
        </p>
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
                  onConsumed={removeProduct}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {dialog.kind === 'create' && (
        <ProductForm categories={categories} onSaved={handleSaved} onCancel={close} />
      )}

      {dialog.kind === 'edit' && (
        <ProductForm
          product={dialog.product}
          categories={categories}
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
          onClose={close}
          onTripChanged={handleTripChanged}
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
