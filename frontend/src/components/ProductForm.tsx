import { useMemo, useState, type FormEvent } from 'react'

import { Modal } from '@/components/Modal'
import { LOCATION_LABELS } from '@/labels'
import { toErrorMessage } from '@/services/api'
import { createProduct, replaceProduct } from '@/services/productsService'
import type { Category, Location, Product, ProductPayload } from '@/services/types'

interface ProductFormProps {
  /** Omit to create; pass a product to edit it. */
  product?: Product
  /** Passed in rather than fetched here, so opening the form costs no request. */
  categories: Category[]
  onSaved: () => void
  onCancel: () => void
}

/** Common units, offered as suggestions without restricting what can be typed. */
const UNIT_SUGGESTIONS = ['piezas', 'kg', 'g', 'litros', 'ml', 'bolsa', 'paquete', 'lata']

interface FormState {
  name: string
  category_id: string
  quantity: string
  unit: string
  expires_at: string
  location: Location
  notes: string
}

function initialState(product?: Product): FormState {
  return {
    name: product?.name ?? '',
    category_id: product?.category_id?.toString() ?? '',
    // Strip the trailing zeros the API sends so the field is not "2.00".
    quantity: product ? product.quantity.replace(/\.?0+$/, '') : '1',
    unit: product?.unit ?? '',
    expires_at: product?.expires_at ?? '',
    location: product?.location ?? 'fridge',
    notes: product?.notes ?? '',
  }
}

/** Create or edit a product. The same form serves both. */
export function ProductForm({ product, categories, onSaved, onCancel }: ProductFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(product))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = product !== undefined

  // Categories arrive asynchronously. Until they do, a select whose value has
  // no matching option falls back to "Sin categoría" — and saving in that
  // window would silently strip the product's category. Seeding its own
  // category keeps the value valid from the first paint.
  const options = useMemo(() => {
    const own = product?.category
    if (own && !categories.some((category) => category.id === own.id)) {
      return [own, ...categories]
    }
    return categories
  }, [categories, product])

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [field]: value }))

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload: ProductPayload = {
      name: form.name.trim(),
      category_id: form.category_id === '' ? null : Number(form.category_id),
      quantity: form.quantity,
      unit: form.unit.trim() === '' ? null : form.unit.trim(),
      expires_at: form.expires_at,
      location: form.location,
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
    }

    void (async () => {
      try {
        if (product) {
          await replaceProduct(product.id, payload)
        } else {
          await createProduct(payload)
        }
        onSaved()
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setSaving(false)
      }
    })()
  }

  return (
    <Modal title={isEdit ? 'Editar producto' : 'Agregar producto'} onClose={onCancel}>
      <form className="form" onSubmit={handleSubmit}>
        <label className="form__field">
          <span>Nombre</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
            maxLength={255}
            autoFocus
          />
        </label>

        <label className="form__field">
          <span>Caduca el</span>
          <input
            type="date"
            value={form.expires_at}
            onChange={(event) => update('expires_at', event.target.value)}
            required
          />
        </label>

        <label className="form__field">
          <span>Dónde está</span>
          <select
            value={form.location}
            onChange={(event) => update('location', event.target.value as Location)}
          >
            {Object.entries(LOCATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="form__field">
          <span>Categoría</span>
          <select
            value={form.category_id}
            onChange={(event) => update('category_id', event.target.value)}
          >
            <option value="">Sin categoría</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <div className="form__row">
          <label className="form__field">
            <span>Cantidad</span>
            <input
              type="number"
              value={form.quantity}
              onChange={(event) => update('quantity', event.target.value)}
              min="0.01"
              step="0.01"
              required
            />
          </label>

          <label className="form__field">
            <span>Unidad</span>
            <input
              type="text"
              value={form.unit}
              onChange={(event) => update('unit', event.target.value)}
              list="unit-suggestions"
              maxLength={50}
              placeholder="piezas"
            />
            <datalist id="unit-suggestions">
              {UNIT_SUGGESTIONS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="form__field">
          <span>Notas</span>
          <textarea
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            rows={2}
            placeholder="abierto, congelado…"
          />
        </label>

        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}

        <div className="form__actions">
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="button--primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
