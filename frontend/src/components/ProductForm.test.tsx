import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProductForm } from '@/components/ProductForm'
import type { Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  createProduct: vi.fn(),
  replaceProduct: vi.fn(),
}))

const products = await import('@/services/productsService')
const mockedCreate = vi.mocked(products.createProduct)

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
