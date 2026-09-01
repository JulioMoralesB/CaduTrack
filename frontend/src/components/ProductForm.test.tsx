import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProductForm } from '@/components/ProductForm'
import type { LabelExtraction, Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  createProduct: vi.fn(),
  replaceProduct: vi.fn(),
}))

vi.mock('@/services/visionService', () => ({
  extractLabel: vi.fn(),
}))

const products = await import('@/services/productsService')
const vision = await import('@/services/visionService')
const mockedCreate = vi.mocked(products.createProduct)
const mockedExtract = vi.mocked(vision.extractLabel)

function labelExtraction(overrides: Partial<LabelExtraction> = {}): LabelExtraction {
  return { name: null, expires_at: null, quantity: null, unit: null, ...overrides }
}

function selectPhoto() {
  const file = new File(['fake'], 'label.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Foto de la etiqueta (opcional)'), {
    target: { files: [file] },
  })
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
      <ProductForm categories={[]} onSaved={onSaved} onCancel={vi.fn()} />,
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
      <ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(container.querySelector('.spinner')).toBeNull()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })
})

describe('ProductForm quantity stepper', () => {
  it('hides "−" at the default quantity of 1', () => {
    render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Reducir cantidad' })).not.toBeInTheDocument()
  })

  it('shows "−" again once "+" has been pressed, and hides it once stepped back to 1', () => {
    render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

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

    render(<ProductForm product={product} categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

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

    const { unmount } = render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Foto de la etiqueta (opcional)')).toBeInTheDocument()
    unmount()

    render(<ProductForm product={product} categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByLabelText('Foto de la etiqueta (opcional)')).not.toBeInTheDocument()
  })

  it('pre-fills every field the model returned', async () => {
    mockedExtract.mockResolvedValue(
      labelExtraction({ name: 'Nopal limpio', expires_at: '2026-09-01', quantity: '0.59', unit: 'kg' }),
    )
    render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    selectPhoto()

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    expect(screen.getByLabelText('Caduca el')).toHaveValue('2026-09-01')
    expect(screen.getByLabelText('Cantidad')).toHaveValue(0.59)
    expect(screen.getByLabelText('Unidad')).toHaveValue('kg')
    expect(screen.getByText('Foto leída. Revisa los datos antes de guardar.')).toBeInTheDocument()
  })

  it('leaves a field the model could not read untouched', async () => {
    mockedExtract.mockResolvedValue(labelExtraction({ name: 'Nopal limpio' }))
    render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'piezas' } })

    selectPhoto()

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))
    // Untouched by the scan: still whatever the user had already typed.
    expect(screen.getByLabelText('Unidad')).toHaveValue('piezas')
    expect(screen.getByLabelText('Caduca el')).toHaveValue('')
  })

  it('says so when nothing in the photo could be read', async () => {
    mockedExtract.mockResolvedValue(labelExtraction())
    render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    selectPhoto()

    expect(
      await screen.findByText('No se pudo leer nada de la foto. Completa los campos manualmente.'),
    ).toBeInTheDocument()
  })

  it('shows the failure inline and leaves the rest of the form usable', async () => {
    mockedExtract.mockRejectedValue(new Error('nope'))
    render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

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
    render(<ProductForm categories={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    selectPhoto()

    expect(screen.getByLabelText('Foto de la etiqueta (opcional)')).toBeDisabled()
    resolveRequest(labelExtraction())
    await waitFor(() => expect(screen.getByLabelText('Foto de la etiqueta (opcional)')).not.toBeDisabled())
  })
})
