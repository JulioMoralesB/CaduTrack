import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductForm } from '@/components/ProductForm'
import type { BarcodeLookupResult, LabelExtraction, Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  createProduct: vi.fn(),
  replaceProduct: vi.fn(),
  adjustProductQuantity: vi.fn(),
}))

vi.mock('@/services/visionService', () => ({
  extractLabel: vi.fn(),
}))

vi.mock('@/services/barcodesService', () => ({
  lookupBarcode: vi.fn(),
  rememberBarcode: vi.fn(),
}))

// Camera access and BarcodeDetector/zxing have their own coverage in
// BarcodeScanner.test.tsx — here only the detected value matters, so the
// component is replaced with two buttons standing in for what it reports.
vi.mock('@/components/BarcodeScanner', () => ({
  BarcodeScanner: ({ onDetected, onCancel }: { onDetected: (raw: string) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onDetected('5449000000996')}>
        fake-detect
      </button>
      <button type="button" onClick={onCancel}>
        fake-cancel-scan
      </button>
    </div>
  ),
}))

const products = await import('@/services/productsService')
const vision = await import('@/services/visionService')
const barcodes = await import('@/services/barcodesService')
const mockedCreate = vi.mocked(products.createProduct)
const mockedAdjustQuantity = vi.mocked(products.adjustProductQuantity)
const mockedExtract = vi.mocked(vision.extractLabel)
const mockedLookupBarcode = vi.mocked(barcodes.lookupBarcode)
const mockedRememberBarcode = vi.mocked(barcodes.rememberBarcode)

function labelExtraction(overrides: Partial<LabelExtraction> = {}): LabelExtraction {
  return { name: null, expires_at: null, quantity: null, unit: null, ...overrides }
}

function barcodeLookupResult(overrides: Partial<BarcodeLookupResult> = {}): BarcodeLookupResult {
  return { item_code: '5449000000996', name: null, icon: null, quantity: null, unit: null, ...overrides }
}

function selectPhoto() {
  const file = new File(['fake'], 'label.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Foto de la etiqueta (opcional)'), {
    target: { files: [file] },
  })
}

function scanBarcode() {
  fireEvent.click(screen.getByRole('button', { name: 'Escanear código de barras' }))
  fireEvent.click(screen.getByRole('button', { name: 'fake-detect' }))
}

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Nopal limpio',
    category_id: null,
    quantity: '1.00',
    unit: null,
    expires_at: '2026-09-10',
    location: 'fridge',
    notes: null,
    category: null,
    icon: '\u{1F955}',
    icon_source: 'default',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    consumed_at: null,
    days_until_expiry: 10,
    status: 'fresh',
    ...overrides,
  }
}


/**
 * Fill only what the form requires, then submit.
 *
 * The retry itself lives inside `createProduct`, so from here a save is a
 * single pending promise however many attempts it is really making — which is
 * exactly the state the spinner has to survive.
 */
function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nopal limpio' } })
  fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2026-09-01' } })
  fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
}

describe('ProductForm while saving', () => {
  it('shows a spinner and holds it until the save settles', async () => {
    let finish: (product: Product) => void = () => {}
    mockedCreate.mockReturnValue(
      new Promise<Product>((resolve) => {
        finish = resolve
      }),
    )
    const onSaved = vi.fn()

    const { container } = render(
      <ProductForm categories={[]} products={[]} onSaved={onSaved} onCancel={vi.fn()} />,
    )
    fillAndSubmit()

    // Mid-flight: the retry may still be working, and the user must be able to
    // tell that from a frozen dialog.
    await waitFor(() => expect(container.querySelector('.spinner')).not.toBeNull())
    expect(screen.getByRole('button', { name: /guardando/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
    expect(onSaved).not.toHaveBeenCalled()

    finish({} as Product)

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('drops the spinner and shows the reason once the attempts are exhausted', async () => {
    mockedCreate.mockRejectedValue(new Error('nope'))

    const { container } = render(
      <ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(container.querySelector('.spinner')).toBeNull()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })
})

describe('ProductForm quantity stepper', () => {
  it('hides "−" at the default quantity of 1', () => {
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Reducir cantidad' })).not.toBeInTheDocument()
  })

  it('shows "−" again once "+" has been pressed, and hides it once stepped back to 1', () => {
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad' }))
    expect(screen.getByRole('button', { name: 'Reducir cantidad' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reducir cantidad' }))
    expect(screen.queryByRole('button', { name: 'Reducir cantidad' })).not.toBeInTheDocument()
  })

  it('shows "−" when editing a product whose quantity is already above 1', () => {
    const product: Product = {
      id: 1,
      name: 'Huevos',
      category_id: null,
      quantity: '6.00',
      unit: 'piezas',
      expires_at: '2026-09-10',
      location: 'fridge',
      notes: null,
      category: null,
      icon: '\u{1F95A}',
      icon_source: 'lookup',
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
      consumed_at: null,
      days_until_expiry: 5,
      status: 'expiring_soon',
    }

    render(<ProductForm product={product} categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Reducir cantidad' })).toBeInTheDocument()
  })
})

describe('ProductForm label scan', () => {
  it('offers the scan field when creating, not when editing', () => {
    const product: Product = {
      id: 1,
      name: 'Huevos',
      category_id: null,
      quantity: '6.00',
      unit: 'piezas',
      expires_at: '2026-09-10',
      location: 'fridge',
      notes: null,
      category: null,
      icon: '\u{1F95A}',
      icon_source: 'lookup',
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
      consumed_at: null,
      days_until_expiry: 5,
      status: 'expiring_soon',
    }

    const { unmount } = render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Foto de la etiqueta (opcional)')).toBeInTheDocument()
    unmount()

    render(<ProductForm product={product} categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByLabelText('Foto de la etiqueta (opcional)')).not.toBeInTheDocument()
  })

  it('pre-fills every field the model returned', async () => {
    mockedExtract.mockResolvedValue(
      labelExtraction({ name: 'Nopal limpio', expires_at: '2026-09-01', quantity: '0.59', unit: 'kg' }),
    )
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    selectPhoto()

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    expect(screen.getByLabelText('Caduca el')).toHaveValue('2026-09-01')
    expect(screen.getByLabelText('Cantidad')).toHaveValue(0.59)
    expect(screen.getByLabelText('Unidad')).toHaveValue('kg')
    expect(screen.getByText('Foto leída. Revisa los datos antes de guardar.')).toBeInTheDocument()
  })

  it('leaves a field the model could not read untouched', async () => {
    mockedExtract.mockResolvedValue(labelExtraction({ name: 'Nopal limpio' }))
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'piezas' } })

    selectPhoto()

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    // Untouched by the scan: still whatever the user had already typed.
    expect(screen.getByLabelText('Unidad')).toHaveValue('piezas')
    expect(screen.getByLabelText('Caduca el')).toHaveValue('')
  })

  it('says so when nothing in the photo could be read', async () => {
    mockedExtract.mockResolvedValue(labelExtraction())
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    selectPhoto()

    expect(
      await screen.findByText('No se pudo leer nada de la foto. Completa los campos manualmente.'),
    ).toBeInTheDocument()
  })

  it('shows the failure inline and leaves the rest of the form usable', async () => {
    mockedExtract.mockRejectedValue(new Error('nope'))
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    selectPhoto()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    // Manual entry still works — the failure did not block the rest of the form.
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Huevos' } })
    expect(screen.getByLabelText('Nombre')).toHaveValue('Huevos')
  })

  it('disables the scan input while a photo is being read', async () => {
    let resolveRequest: (result: LabelExtraction) => void = () => {}
    mockedExtract.mockReturnValue(
      new Promise<LabelExtraction>((resolve) => {
        resolveRequest = resolve
      }),
    )
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    selectPhoto()

    expect(screen.getByLabelText('Foto de la etiqueta (opcional)')).toBeDisabled()
    resolveRequest(labelExtraction())
    await waitFor(() => expect(screen.getByLabelText('Foto de la etiqueta (opcional)')).not.toBeDisabled())
  })
})

describe('ProductForm barcode scan', () => {
  // Several of these tests assert call counts on lookupBarcode/rememberBarcode,
  // which nothing else in this file resets between tests.
  beforeEach(() => {
    vi.clearAllMocks()
    // A bare vi.fn() with no return value resolves to undefined rather than
    // a Promise, and ProductForm always chains .catch() onto this call — a
    // test that never overrides it would otherwise crash on a mock, not on
    // anything the component itself does wrong.
    mockedRememberBarcode.mockResolvedValue(undefined)
  })

  it('offers the scan button when creating, not when editing', () => {
    const { unmount } = render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Escanear código de barras' })).toBeInTheDocument()
    unmount()

    render(<ProductForm product={fakeProduct()} categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Escanear código de barras' })).not.toBeInTheDocument()
  })

  it('pre-fills what the lookup returned, and never touches the expiry date', async () => {
    mockedLookupBarcode.mockResolvedValue(
      barcodeLookupResult({ name: 'Nopal limpio', quantity: '0.59', unit: 'kg' }),
    )
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    scanBarcode()

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    expect(screen.getByLabelText('Cantidad')).toHaveValue(0.59)
    expect(screen.getByLabelText('Unidad')).toHaveValue('kg')
    // A barcode never carries an expiry date — see #30 — so this is left
    // exactly as it started, for the user to fill in by hand.
    expect(screen.getByLabelText('Caduca el')).toHaveValue('')
    expect(screen.getByText('Código escaneado. Revisa los datos antes de guardar.')).toBeInTheDocument()
  })

  it('leaves a field the lookup could not resolve untouched', async () => {
    mockedLookupBarcode.mockResolvedValue(barcodeLookupResult({ name: 'Nopal limpio' }))
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'piezas' } })

    scanBarcode()

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    expect(screen.getByLabelText('Unidad')).toHaveValue('piezas')
  })

  it('says so when a restricted-circulation code carries no known name', async () => {
    mockedLookupBarcode.mockResolvedValue(barcodeLookupResult())
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    scanBarcode()

    expect(
      await screen.findByText('Código leído, pero sin información conocida. Completa los campos manualmente.'),
    ).toBeInTheDocument()
  })

  it('shows the failure inline and leaves the rest of the form usable', async () => {
    mockedLookupBarcode.mockRejectedValue(new Error('nope'))
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    scanBarcode()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Huevos' } })
    expect(screen.getByLabelText('Nombre')).toHaveValue('Huevos')
  })

  it('closes on cancel without touching the form', () => {
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Escanear código de barras' }))
    fireEvent.click(screen.getByRole('button', { name: 'fake-cancel-scan' }))

    expect(screen.queryByRole('button', { name: 'fake-cancel-scan' })).not.toBeInTheDocument()
    expect(mockedLookupBarcode).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nombre')).toHaveValue('')
  })

  it('remembers the scanned code once the product it fed is actually saved', async () => {
    mockedLookupBarcode.mockResolvedValue(barcodeLookupResult({ name: 'Nopal limpio', quantity: '0.59', unit: 'kg' }))
    const saved = fakeProduct({ name: 'Nopal limpio (confirmado)', icon: '\u{1F955}' })
    mockedCreate.mockResolvedValue(saved)
    const onSaved = vi.fn()
    render(<ProductForm categories={[]} products={[]} onSaved={onSaved} onCancel={vi.fn()} />)

    scanBarcode()
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2026-09-10' } })
    // The name below is what the user actually confirmed in the form —
    // remember() must reflect that, not the raw lookup result, since the
    // two can differ once the user edits before saving.
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nopal limpio (confirmado)' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(mockedRememberBarcode).toHaveBeenCalledWith('5449000000996', 'Nopal limpio (confirmado)', '\u{1F955}')
  })

  it('does not remember anything when no barcode was ever scanned', async () => {
    mockedCreate.mockResolvedValue(fakeProduct())
    render(<ProductForm categories={[]} products={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    fillAndSubmit()

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce())
    expect(mockedRememberBarcode).not.toHaveBeenCalled()
  })

  it('does not let a failed remember block the save from completing', async () => {
    mockedLookupBarcode.mockResolvedValue(barcodeLookupResult({ name: 'Nopal limpio' }))
    mockedRememberBarcode.mockRejectedValue(new Error('boom'))
    const saved = fakeProduct()
    mockedCreate.mockResolvedValue(saved)
    const onSaved = vi.fn()
    render(<ProductForm categories={[]} products={[]} onSaved={onSaved} onCancel={vi.fn()} />)

    scanBarcode()
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2026-09-10' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
  })
})

describe('ProductForm duplicate check', () => {
  // Nothing else in this file resets mocks between tests — see the
  // barcode-scan describe above for the same fix, same reason.
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Real, unmocked "now" throughout — findDuplicateToday compares calendar
  // days with new Date(), and matching that against a fixed fake date would
  // put fake timers in the way of every await waitFor(...) below, which
  // relies on real timers to poll.
  function createdToday(): string {
    return new Date().toISOString()
  }

  function createdYesterday(): string {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  }

  it('shows the three-way choice instead of saving, when the name matches an active product created today', () => {
    const existing = fakeProduct({ id: 9, name: 'Nopal limpio', quantity: '0.50', unit: 'kg', created_at: createdToday() })
    render(<ProductForm categories={[]} products={[existing]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    fillAndSubmit()

    expect(screen.getByRole('alert')).toHaveTextContent('Ya agregaste "Nopal limpio" hoy (0.5 kg)')
    expect(screen.getByRole('button', { name: 'Agregar de todas formas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sumar a la cantidad existente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Omitir' })).toBeInTheDocument()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('does not flag a product with the same name created on a previous day', () => {
    const existing = fakeProduct({ name: 'Nopal limpio', created_at: createdYesterday() })
    mockedCreate.mockResolvedValue(fakeProduct())
    render(<ProductForm categories={[]} products={[existing]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    fillAndSubmit()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockedCreate).toHaveBeenCalledOnce()
  })

  it('does not check for a duplicate when editing — a product can never duplicate itself', async () => {
    const existing = fakeProduct({ id: 3, name: 'Nopal limpio', created_at: createdToday() })
    const mockedReplace = vi.mocked(products.replaceProduct)
    mockedReplace.mockResolvedValue(existing)
    render(<ProductForm product={existing} categories={[]} products={[existing]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2026-09-10' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(mockedReplace).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Omitir' })).not.toBeInTheDocument()
  })

  it('"Agregar de todas formas" creates a second product as normal', async () => {
    const existing = fakeProduct({ name: 'Nopal limpio', created_at: createdToday() })
    const saved = fakeProduct({ id: 20 })
    mockedCreate.mockResolvedValue(saved)
    const onSaved = vi.fn()
    render(<ProductForm categories={[]} products={[existing]} onSaved={onSaved} onCancel={vi.fn()} />)
    fillAndSubmit()

    fireEvent.click(screen.getByRole('button', { name: 'Agregar de todas formas' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(mockedCreate).toHaveBeenCalledOnce()
  })

  it('"Sumar a la cantidad existente" adjusts the existing product instead of creating a new one', async () => {
    const existing = fakeProduct({ id: 9, name: 'Nopal limpio', created_at: createdToday() })
    const updated = fakeProduct({ id: 9, name: 'Nopal limpio', quantity: '1.50' })
    mockedAdjustQuantity.mockResolvedValue(updated)
    const onSaved = vi.fn()
    render(<ProductForm categories={[]} products={[existing]} onSaved={onSaved} onCancel={vi.fn()} />)
    fillAndSubmit()

    fireEvent.click(screen.getByRole('button', { name: 'Sumar a la cantidad existente' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(mockedAdjustQuantity).toHaveBeenCalledWith(9, 1)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('"Omitir" adds nothing and defers to onCancel, same as skipping any other add', () => {
    const existing = fakeProduct({ name: 'Nopal limpio', created_at: createdToday() })
    const onCancel = vi.fn()
    render(<ProductForm categories={[]} products={[existing]} onSaved={vi.fn()} onCancel={onCancel} />)
    fillAndSubmit()

    fireEvent.click(screen.getByRole('button', { name: 'Omitir' }))

    expect(onCancel).toHaveBeenCalledOnce()
    expect(mockedCreate).not.toHaveBeenCalled()
    expect(mockedAdjustQuantity).not.toHaveBeenCalled()
  })

  it('clears a stale warning once the name is edited, so the next submit re-checks against the new name', () => {
    const existing = fakeProduct({ name: 'Nopal limpio', created_at: createdToday() })
    mockedCreate.mockResolvedValue(fakeProduct())
    render(<ProductForm categories={[]} products={[existing]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fillAndSubmit()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nopal limpio, otra marca' } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    expect(mockedCreate).toHaveBeenCalledOnce()
  })
})
