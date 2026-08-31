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
