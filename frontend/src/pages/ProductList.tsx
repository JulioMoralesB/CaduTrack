import { useMemo, useState } from 'react'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ProductCard } from '@/components/ProductCard'
import { ProductFilters } from '@/components/ProductFilters'
import { ProductForm } from '@/components/ProductForm'
import { ProductHistory } from '@/components/ProductHistory'
import { StaleBanner } from '@/components/StaleBanner'
import { SettingsDialog } from '@/components/SettingsDialog'
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
import type { Product } from '@/services/types'

/** What the screen is currently doing, beyond showing the list. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; product: Product }
  | { kind: 'delete'; product: Product }
  | { kind: 'settings' }
  | { kind: 'history' }

/** Main screen: everything in the house, soonest to expire first. */
export function ProductList() {
  const { products, loading, error, unreachable, cachedAt, reload, replaceProduct, removeProduct } = useProducts()
  const categories = useCategories()
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<SortKey>('expiry')

  const visible = useMemo(
    () => sortProducts(applyFilters(products, filters), sort),
    [products, filters, sort],
  )

  const close = () => {
    setDialog({ kind: 'none' })
    setDeleteError(null)
  }

  const handleSaved = () => {
    close()
    reload()
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
        <button
          type="button"
          className="button--primary"
          onClick={() => setDialog({ kind: 'create' })}
        >
          Agregar producto
        </button>
      </div>

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
