import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LabelQueueDialog } from '@/components/LabelQueueDialog'
import type { Category, LabelScan, Product, ProductNameSuggestion } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  createProduct: vi.fn(),
  replaceProduct: vi.fn(),
}))

vi.mock('@/services/visionService', () => ({
  extractLabel: vi.fn(),
}))

vi.mock('@/services/labelScansService', () => ({
  dropLabelScan: vi.fn(),
  resolveLabelScan: vi.fn(),
  retryLabelScan: vi.fn(),
  labelScanImageUrl: (id: number) => `/api/label-scans/${id}/image`,
}))

const products = await import('@/services/productsService')
const labelScans = await import('@/services/labelScansService')
const mockedCreate = vi.mocked(products.createProduct)
const mockedDrop = vi.mocked(labelScans.dropLabelScan)
const mockedResolve = vi.mocked(labelScans.resolveLabelScan)
const mockedRetry = vi.mocked(labelScans.retryLabelScan)

function scan(overrides: Partial<LabelScan> = {}): LabelScan {
  return {
    id: 1,
    created_at: '2026-09-22T00:00:00Z',
    status: 'read',
    name: 'Yogur natural',
    expires_at: '2026-10-15',
    quantity: '0.90',
    unit: 'kg',
    resolved_at: null,
    product_id: null,
    ...overrides,
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 7,
    name: 'Yogur natural',
    category_id: null,
    quantity: '0.90',
    unit: 'kg',
    expires_at: '2026-10-15',
    location: 'fridge',
    notes: null,
    category: null,
    icon: '\u{1F95B}',
    icon_source: 'lookup',
    created_at: '2026-09-22T00:00:00Z',
    updated_at: '2026-09-22T00:00:00Z',
    consumed_at: null,
    days_until_expiry: 23,
    status: 'fresh',
    ...overrides,
  }
}

function renderDialog(
  scans: LabelScan[],
  { categories = [], nameSuggestions = [] }: { categories?: Category[]; nameSuggestions?: ProductNameSuggestion[] } = {},
) {
  const onClose = vi.fn()
  const onChanged = vi.fn()
  const view = render(
    <LabelQueueDialog
      scans={scans}
      categories={categories}
      products={[]}
      nameSuggestions={nameSuggestions}
      onClose={onClose}
      onChanged={onChanged}
    />,
  )
  return { ...view, onClose, onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LabelQueueDialog review', () => {
  it('shows each photo by where its reading stands', () => {
    renderDialog([
      scan({ id: 1 }),
      scan({ id: 2, status: 'pending', name: null, expires_at: null, quantity: null, unit: null }),
      scan({ id: 3, status: 'failed', name: null, expires_at: null, quantity: null, unit: null }),
      scan({ id: 4, name: null, expires_at: null, quantity: null, unit: null }),
    ])

    expect(screen.getByText('Yogur natural')).toBeInTheDocument()
    // ICU versions differ on "oct" vs "oct." for es-MX.
    expect(screen.getByText(/^Caduca 15 oct\.? 2026 · 0\.9 kg$/)).toBeInTheDocument()
    expect(screen.getByText('Leyendo…')).toBeInTheDocument()
    expect(screen.getByText('No se pudo leer')).toBeInTheDocument()
    expect(screen.getByText('Sin nombre legible')).toBeInTheDocument()
  })

  it('shows each photo itself as a thumbnail', () => {
    const { container } = renderDialog([scan({ id: 9 })])

    expect(container.querySelector('img')).toHaveAttribute('src', '/api/label-scans/9/image')
  })

  it('says the app stays usable only while something is still being read', () => {
    const { rerender } = renderDialog([scan({ status: 'pending', name: null })])
    expect(screen.getByText(/seguir usando la app/)).toBeInTheDocument()

    rerender(
      <LabelQueueDialog scans={[scan()]} categories={[]} products={[]} onClose={vi.fn()} onChanged={vi.fn()} />,
    )
    expect(screen.queryByText(/seguir usando la app/)).not.toBeInTheDocument()
  })

  it('offers no Agregar while a photo is still being read', () => {
    renderDialog([scan({ status: 'pending', name: null })])

    expect(screen.queryByRole('button', { name: /^agregar/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /descartar/i })).toBeInTheDocument()
  })

  it('drops a photo and reports the change', async () => {
    mockedDrop.mockResolvedValue(scan({ resolved_at: '2026-09-22T01:00:00Z' }))
    const { onChanged } = renderDialog([scan({ id: 3 })])

    fireEvent.click(screen.getByRole('button', { name: 'Descartar Yogur natural' }))

    await waitFor(() => expect(mockedDrop).toHaveBeenCalledWith(3))
    expect(onChanged).toHaveBeenCalled()
  })

  it('retries a failed read', async () => {
    mockedRetry.mockResolvedValue(scan({ status: 'pending' }))
    const { onChanged } = renderDialog([scan({ id: 4, status: 'failed', name: null })])

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(mockedRetry).toHaveBeenCalledWith(4))
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows an error when an action fails', async () => {
    mockedDrop.mockRejectedValue(new Error('boom'))
    renderDialog([scan()])

    fireEvent.click(screen.getByRole('button', { name: /descartar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
  })
})

describe('LabelQueueDialog adding', () => {
  it('prefills the form with everything the label read', () => {
    renderDialog([scan()])

    fireEvent.click(screen.getByRole('button', { name: 'Agregar Yogur natural' }))

    expect(screen.getByLabelText('Nombre')).toHaveValue('Yogur natural')
    expect(screen.getByLabelText('Caduca el')).toHaveValue('2026-10-15')
    // A number input: its value reads back as a number, not the API's string.
    expect(screen.getByLabelText('Cantidad')).toHaveValue(0.9)
    expect(screen.getByLabelText('Unidad')).toHaveValue('kg')
  })

  it('reuses a known name’s category and location as soon as the form opens — see #133', () => {
    renderDialog([scan({ name: 'YOGUR NATURAL' })], {
      categories: [{ id: 3, name: 'Lácteos', created_at: '2026-08-29T00:00:00Z' }],
      nameSuggestions: [{ name: 'Yogur natural', category_id: 3, location: 'pantry' }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Agregar YOGUR NATURAL' }))

    expect(screen.getByLabelText('Categoría')).toHaveValue('3')
    expect(screen.getByLabelText('Dónde está')).toHaveValue('pantry')
  })

  it('links the saved product to the photo and returns to the list', async () => {
    mockedCreate.mockResolvedValue(product({ id: 7 }))
    mockedResolve.mockResolvedValue(scan({ id: 2, product_id: 7, resolved_at: '2026-09-22T01:00:00Z' }))
    const { onChanged } = renderDialog([scan({ id: 2 })])

    fireEvent.click(screen.getByRole('button', { name: 'Agregar Yogur natural' }))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(mockedResolve).toHaveBeenCalledWith(2, 7))
    expect(onChanged).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Etiquetas' })).toBeInTheDocument()
  })

  it('walks through every read photo one at a time, skipping ones still being read', () => {
    renderDialog([
      scan({ id: 1, name: 'Yogur natural' }),
      scan({ id: 2, status: 'pending', name: null }),
      scan({ id: 3, name: 'Jamón de pavo' }),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Agregar las 2 leídas' }))
    expect(screen.getByRole('heading', { name: 'Agregar producto (quedan 2)' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveValue('Yogur natural')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('heading', { name: 'Agregar producto' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveValue('Jamón de pavo')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('heading', { name: 'Etiquetas' })).toBeInTheDocument()
  })

  it('skips a photo that left the queue since the walk started', () => {
    const { rerender } = renderDialog([scan({ id: 1, name: 'Yogur natural' }), scan({ id: 2, name: 'Jamón de pavo' })])
    fireEvent.click(screen.getByRole('button', { name: 'Agregar las 2 leídas' }))

    rerender(
      <LabelQueueDialog
        scans={[scan({ id: 2, name: 'Jamón de pavo' })]}
        categories={[]}
        products={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Nombre')).toHaveValue('Jamón de pavo')
  })

  it('lets a failed read be added by hand', () => {
    renderDialog([scan({ id: 5, status: 'failed', name: null, expires_at: null, quantity: null, unit: null })])

    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto 5' }))

    expect(screen.getByLabelText('Nombre')).toHaveValue('')
  })
})
