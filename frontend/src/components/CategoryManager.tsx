import { useState, type FormEvent, type KeyboardEvent } from 'react'

import { toErrorMessage } from '@/services/api'
import { createCategory, deleteCategory, renameCategory } from '@/services/categoriesService'
import type { Category, Product } from '@/services/types'

interface CategoryManagerProps {
  categories: Category[]
  products: Product[]
  /** Awaited, so the list on screen is current before the row settles. */
  onChanged: (deletedId?: number) => Promise<void>
}

type Target = number | 'new'

function productCount(count: number): string {
  if (count === 0) return 'Sin productos'
  return count === 1 ? '1 producto' : `${count} productos`
}

function deleteConsequence(count: number): string {
  if (count === 0) return 'Ningún producto la usa.'
  return count === 1 ? '1 producto quedará sin categoría.' : `${count} productos quedarán sin categoría.`
}

/**
 * Add, rename and delete categories from Ajustes — see #144. Collapsed by
 * default: it's visited rarely and would otherwise double the sheet's height.
 * Each failure shows on the row it belongs to, the same lesson as #155.
 */
export function CategoryManager({ categories, products, onChanged }: CategoryManagerProps) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)
  const [busy, setBusy] = useState<Target | null>(null)
  const [failure, setFailure] = useState<{ target: Target; message: string } | null>(null)

  const countFor = (category: Category) =>
    products.filter((product) => product.category_id === category.id).length

  const run = (target: Target, action: () => Promise<void>) => {
    setBusy(target)
    setFailure(null)
    void (async () => {
      try {
        await action()
      } catch (caught) {
        setFailure({ target, message: toErrorMessage(caught) })
      } finally {
        setBusy(null)
      }
    })()
  }

  const handleAdd = (event: FormEvent) => {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    run('new', async () => {
      await createCategory(name)
      setNewName('')
      await onChanged()
    })
  }

  const startEditing = (category: Category) => {
    setEditing({ id: category.id, name: category.name })
    setConfirmingDelete(null)
    setFailure(null)
  }

  const handleRename = (event: FormEvent, category: Category) => {
    event.preventDefault()
    const name = editing?.name.trim()
    if (!name) return
    if (name === category.name) {
      setEditing(null)
      return
    }
    run(category.id, async () => {
      await renameCategory(category.id, name)
      setEditing(null)
      await onChanged()
    })
  }

  // Stopped here so Escape backs out of the rename, not the whole dialog.
  const handleEditKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    setEditing(null)
  }

  const handleDelete = (category: Category) => {
    run(category.id, async () => {
      await deleteCategory(category.id)
      setConfirmingDelete(null)
      await onChanged(category.id)
    })
  }

  const errorFor = (target: Target) =>
    failure?.target === target && (
      <p className="form__error" role="alert">
        {failure.message}
      </p>
    )

  return (
    <div className="category-manager">
      <p className="settings__section-title">Categorías</p>
      <button
        type="button"
        className="category-manager__toggle"
        aria-expanded={open}
        aria-controls="category-manager-body"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Ocultar categorías' : `Administrar categorías (${categories.length})`}
      </button>

      {open && (
        <div id="category-manager-body" className="category-manager">
          <ul className="category-manager__list">
            {categories.map((category) => {
              const count = countFor(category)
              const rowBusy = busy === category.id
              return (
                <li key={category.id} className="category-manager__row">
                  {editing?.id === category.id ? (
                    <form className="category-manager__form" onSubmit={(event) => handleRename(event, category)}>
                      <input
                        type="text"
                        value={editing.name}
                        onChange={(event) => setEditing({ id: category.id, name: event.target.value })}
                        onKeyDown={handleEditKeyDown}
                        aria-label={`Nuevo nombre de ${category.name}`}
                        maxLength={100}
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="button--primary"
                        disabled={rowBusy || !editing.name.trim()}
                        aria-label={`Guardar nombre de ${category.name}`}
                      >
                        {rowBusy ? 'Guardando…' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={rowBusy}
                        aria-label={`Cancelar cambio de nombre de ${category.name}`}
                      >
                        Cancelar
                      </button>
                    </form>
                  ) : confirmingDelete === category.id ? (
                    <div className="form__duplicate-warning" role="alert">
                      <p>
                        ¿Eliminar "{category.name}"? {deleteConsequence(count)}
                      </p>
                      <div className="form__actions">
                        <button type="button" onClick={() => setConfirmingDelete(null)} disabled={rowBusy}>
                          Volver
                        </button>
                        <button
                          type="button"
                          className="button--danger"
                          onClick={() => handleDelete(category)}
                          disabled={rowBusy}
                        >
                          {rowBusy ? 'Eliminando…' : 'Sí, eliminar'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="category-manager__top">
                      <span className="category-manager__text">
                        <span>{category.name}</span>
                        <span className="category-manager__count">{productCount(count)}</span>
                      </span>
                      <button type="button" onClick={() => startEditing(category)} aria-label={`Renombrar ${category.name}`}>
                        Renombrar
                      </button>
                      <button
                        type="button"
                        className="button--danger-text"
                        onClick={() => {
                          setConfirmingDelete(category.id)
                          setEditing(null)
                          setFailure(null)
                        }}
                        aria-label={`Eliminar ${category.name}`}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                  {errorFor(category.id)}
                </li>
              )
            })}
          </ul>

          <form className="category-manager__form" onSubmit={handleAdd}>
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              aria-label="Nueva categoría"
              placeholder="Nueva categoría"
              maxLength={100}
            />
            <button type="submit" disabled={busy === 'new' || !newName.trim()}>
              {busy === 'new' ? 'Agregando…' : 'Agregar'}
            </button>
          </form>
          {errorFor('new')}
        </div>
      )}
    </div>
  )
}
