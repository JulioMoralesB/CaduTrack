import { useState } from 'react'

import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ProductCard } from '@/components/ProductCard'
import { ProductForm } from '@/components/ProductForm'
import { useProducts } from '@/hooks/useProducts'
import { toErrorMessage } from '@/services/api'
import { deleteProduct } from '@/services/productsService'
import type { Product } from '@/services/types'

/** What the screen is currently doing, beyond showing the list. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; product: Product }
  | { kind: 'delete'; product: Product }

/** Main screen: everything in the house, soonest to expire first. */
export function ProductList() {
  const { products, loading, error, reload } = useProducts()
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
        <button
          type="button"
          className="button--primary"
          onClick={() => setDialog({ kind: 'create' })}
        >
          Agregar producto
        </button>
      </div>

      {loading && <p className="state state--loading">Cargando…</p>}

      {!loading && error && (
        <div className="state state--error" role="alert">
          <p>{error}</p>
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
        <ul className="product-list">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onEdit={(target) => setDialog({ kind: 'edit', product: target })}
              onDelete={(target) => setDialog({ kind: 'delete', product: target })}
            />
          ))}
        </ul>
      )}

      {dialog.kind === 'create' && <ProductForm onSaved={handleSaved} onCancel={close} />}

      {dialog.kind === 'edit' && (
        <ProductForm product={dialog.product} onSaved={handleSaved} onCancel={close} />
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
