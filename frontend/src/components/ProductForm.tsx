import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'

import { BarcodeScanner } from '@/components/BarcodeScanner'
import { Modal } from '@/components/Modal'
import { downscaleImage } from '@/downscaleImage'
import { LOCATION_LABELS } from '@/labels'
import { canStepDown, stepQuantity } from '@/quantity'
import { toErrorMessage } from '@/services/api'
import { lookupBarcode, rememberBarcode } from '@/services/barcodesService'
import { createProduct, replaceProduct } from '@/services/productsService'
import type { Category, Location, Product, ProductPayload } from '@/services/types'
import { extractLabel } from '@/services/visionService'

interface ProductFormProps {
  /** Omit to create; pass a product to edit it. */
  product?: Product
  /** Seeds name and quantity when creating from a shopping trip item's own
   *  reading of the receipt — see #84. Ignored when editing, and only ever
   *  a starting point: both fields stay fully editable, same as a photo
   *  scan's own prefill. */
  prefill?: { name: string; quantity: string }
  /** Passed in rather than fetched here, so opening the form costs no request. */
  categories: Category[]
  /** Called with the server's own response, so a caller that needs the new
   *  product's id — resolving a shopping trip item into it, see #84 — has
   *  it without a second request. */
  onSaved: (product: Product) => void
  onCancel: () => void
  /** Overrides the default "Agregar producto"/"Editar producto" title —
   *  used when this form is one step of a larger flow (adding items from a
   *  shopping trip, see #84) so the user can see progress through it. */
  title?: string
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

function initialState(product?: Product, prefill?: { name: string; quantity: string }): FormState {
  return {
    name: product?.name ?? prefill?.name ?? '',
    category_id: product?.category_id?.toString() ?? '',
    // Strip the trailing zeros the API sends so the field is not "2.00".
    quantity: product ? product.quantity.replace(/\.?0+$/, '') : (prefill?.quantity ?? '1'),
    unit: product?.unit ?? '',
    expires_at: product?.expires_at ?? '',
    location: product?.location ?? 'fridge',
    notes: product?.notes ?? '',
  }
}

/** Create or edit a product. The same form serves both. */
export function ProductForm({ product, prefill, categories, onSaved, onCancel, title }: ProductFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(product, prefill))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanHint, setScanHint] = useState<string | null>(null)

  const [barcodeScanning, setBarcodeScanning] = useState(false)
  const [barcodeLookupPending, setBarcodeLookupPending] = useState(false)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [barcodeHint, setBarcodeHint] = useState<string | null>(null)
  // What to remember() once the save this scan feeds into actually
  // succeeds — see #30. A scan the user abandons or types straight over
  // must not remember anything, so this only ever gets read from
  // handleSubmit, never used on its own.
  const [pendingBarcode, setPendingBarcode] = useState<{ itemCode: string; icon: string | null } | null>(null)

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

  /**
   * The photo is an accuracy shortcut, not a separate flow: it fills in
   * whatever the model was confident about and leaves the rest exactly as
   * it was, so the same "confirm in the form, then Guardar" path handles a
   * photo, a fully typed entry, and everything in between — never a silent
   * save. Only fields the model actually returned are overwritten, so a
   * partial read (say, a date but no readable weight) does not clobber a
   * quantity the user already typed by hand.
   */
  const handleScan = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared immediately so scanning the same photo again — e.g. after a
    // failure — fires a change event the second time too.
    event.target.value = ''
    if (!file) return

    setScanning(true)
    setScanError(null)
    setScanHint(null)
    void (async () => {
      try {
        const extracted = await extractLabel(await downscaleImage(file))
        setForm((current) => ({
          ...current,
          name: extracted.name ?? current.name,
          expires_at: extracted.expires_at ?? current.expires_at,
          quantity: extracted.quantity ?? current.quantity,
          unit: extracted.unit ?? current.unit,
        }))
        setScanHint(
          extracted.name || extracted.expires_at || extracted.quantity
            ? 'Foto leída. Revisa los datos antes de guardar.'
            : 'No se pudo leer nada de la foto. Completa los campos manualmente.',
        )
      } catch (caught) {
        setScanError(toErrorMessage(caught))
      } finally {
        setScanning(false)
      }
    })()
  }

  /**
   * A barcode never carries a name by itself — only what a previous
   * remember() or Open Food Facts said the code was, plus whatever a
   * GS1-128 label's own (310n) field reads as weight. Same merge rule as
   * handleScan: only fields the lookup actually returned are overwritten.
   */
  const handleBarcodeDetected = (raw: string) => {
    setBarcodeScanning(false)
    setBarcodeLookupPending(true)
    setBarcodeError(null)
    setBarcodeHint(null)
    void (async () => {
      try {
        const result = await lookupBarcode(raw)
        setForm((current) => ({
          ...current,
          name: result.name ?? current.name,
          quantity: result.quantity ?? current.quantity,
          unit: result.unit ?? current.unit,
        }))
        setPendingBarcode({ itemCode: result.item_code, icon: result.icon })
        setBarcodeHint(
          result.name || result.quantity
            ? 'Código escaneado. Revisa los datos antes de guardar.'
            : 'Código leído, pero sin información conocida. Completa los campos manualmente.',
        )
      } catch (caught) {
        setBarcodeError(toErrorMessage(caught))
      } finally {
        setBarcodeLookupPending(false)
      }
    })()
  }

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
        const saved = product ? await replaceProduct(product.id, payload) : await createProduct(payload)
        if (pendingBarcode) {
          // Best-effort — see rememberBarcode's own contract. A failed cache
          // write must not undo an already-successful save.
          void rememberBarcode(pendingBarcode.itemCode, saved.name, saved.icon).catch(() => {})
        }
        onSaved(saved)
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setSaving(false)
      }
    })()
  }

  return (
    <Modal title={title ?? (isEdit ? 'Editar producto' : 'Agregar producto')} onClose={onCancel}>
      <form className="form" onSubmit={handleSubmit}>
        {/* The photo is the entry point, not an afterthought — see #83 — so
            it comes first, above manual entry rather than buried below it.
            Only offered when creating: an edit already has real values, and
            re-scanning over them is not a flow this covers. */}
        {!isEdit && (
          <div className="form__scan">
            {/* Explicit htmlFor/id rather than wrapping in a <label>, same
                reasoning as Cantidad below: a wrapping label's accessible
                name is its full text content, and the status paragraphs
                here change while scanning — wrapped, the label's name would
                grow to include "Leyendo etiqueta…" while a scan is in
                flight instead of naming the control. See #91's IconPicker
                for the same fix, same reason. */}
            <div className="form__field">
              <label htmlFor="product-scan">Foto de la etiqueta (opcional)</label>
              <input
                id="product-scan"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleScan}
                disabled={scanning || barcodeLookupPending}
              />
              {scanning && <p className="settings__hint">Leyendo etiqueta…</p>}
              {scanError && (
                <p className="form__error" role="alert">
                  {scanError}
                </p>
              )}
              {scanHint && <p className="settings__hint">{scanHint}</p>}
            </div>

            {/* A barcode never carries an expiry date — see #30 — so this
                only ever fills in name/quantity/unit, same partial-
                overwrite rule as the photo scan above. A separate
                affordance rather than folded into it: a live camera scan
                and a photo upload are different enough interactions to
                need their own button and status. */}
            <div className="form__field">
              <span>Código de barras (opcional)</span>
              <button
                type="button"
                onClick={() => {
                  setBarcodeError(null)
                  setBarcodeHint(null)
                  setBarcodeScanning(true)
                }}
                disabled={scanning || barcodeLookupPending}
              >
                Escanear código de barras
              </button>
              {barcodeLookupPending && <p className="settings__hint">Buscando producto…</p>}
              {barcodeError && (
                <p className="form__error" role="alert">
                  {barcodeError}
                </p>
              )}
              {barcodeHint && <p className="settings__hint">{barcodeHint}</p>}
            </div>
          </div>
        )}

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
          {/* A plain wrapping <label> would implicitly associate its text with
              every control inside it — both buttons as well as the input —
              which makes getByLabelText('Cantidad') ambiguous. An explicit
              htmlFor targets the input alone. */}
          <div className="form__field">
            <label htmlFor="product-quantity">Cantidad</label>
            <span className="quantity-stepper">
              {/* Hidden rather than disabled at 1, matching the card's
                  stepper — see ProductCard.tsx for why. */}
              {canStepDown(form.quantity) && (
                <button
                  type="button"
                  className="quantity-stepper__button"
                  onClick={() => update('quantity', stepQuantity(form.quantity, -1))}
                  aria-label="Reducir cantidad"
                >
                  −
                </button>
              )}
              <input
                id="product-quantity"
                type="number"
                className="quantity-stepper__input"
                value={form.quantity}
                onChange={(event) => update('quantity', event.target.value)}
                min="0.01"
                step="0.01"
                required
              />
              <button
                type="button"
                className="quantity-stepper__button"
                onClick={() => update('quantity', stepQuantity(form.quantity, 1))}
                aria-label="Aumentar cantidad"
              >
                +
              </button>
            </span>
          </div>

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
            {saving ? (
              <>
                {/* Stays up across the whole retry sequence, because `saving`
                    is only cleared once withRetry settles. A dropped
                    connection is exactly when a still-disabled button with no
                    motion reads as a hang. */}
                <span className="spinner" aria-hidden="true" />
                Guardando…
              </>
            ) : (
              'Guardar'
            )}
          </button>
        </div>
      </form>
      {barcodeScanning && (
        <BarcodeScanner onDetected={handleBarcodeDetected} onCancel={() => setBarcodeScanning(false)} />
      )}
    </Modal>
  )
}
