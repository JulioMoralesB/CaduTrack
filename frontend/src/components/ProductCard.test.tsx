import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductCard } from '@/components/ProductCard'
import type { Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  adjustProductQuantity: vi.fn(),
}))

const products = await import('@/services/productsService')
const mockedAdjust = vi.mocked(products.adjustProductQuantity)

beforeEach(() => {
  vi.clearAllMocks()
})

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Plátano',
    category_id: null,
    quantity: '3.00',
    unit: 'piezas',
    expires_at: '2026-09-03',
    location: 'fridge',
    notes: null,
    category: null,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    days_until_expiry: 5,
    status: 'expiring_soon',
    ...overrides,
  }
}

function renderCard(overrides: Partial<Product> = {}) {
  const onQuantityChanged = vi.fn()
  render(
    <ul>
      <ProductCard
        product={product(overrides)}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onQuantityChanged={onQuantityChanged}
      />
    </ul>,
  )
  return { onQuantityChanged }
}

describe('ProductCard quantity stepper', () => {
  it('sends +1 and reports the server response back to the list', async () => {
    const updated = product({ quantity: '4.00' })
    mockedAdjust.mockResolvedValue(updated)
    const { onQuantityChanged } = renderCard({ quantity: '3.00' })

    screen.getByRole('button', { name: 'Aumentar cantidad de Plátano' }).click()

    await waitFor(() => expect(onQuantityChanged).toHaveBeenCalledWith(updated))
    expect(mockedAdjust).toHaveBeenCalledWith(1, 1)
  })

  it('sends -1 from the "−" button', async () => {
    mockedAdjust.mockResolvedValue(product({ quantity: '2.00' }))
    renderCard({ quantity: '3.00' })

    screen.getByRole('button', { name: 'Reducir cantidad de Plátano' }).click()

    await waitFor(() => expect(mockedAdjust).toHaveBeenCalledWith(1, -1))
  })

  it('disables "−" at quantity 1, offering no path to zero', () => {
    renderCard({ quantity: '1.00' })

    expect(screen.getByRole('button', { name: 'Reducir cantidad de Plátano' })).toBeDisabled()
    expect(mockedAdjust).not.toHaveBeenCalled()
  })

  it('keeps "+" enabled at quantity 1 — there is no upper bound', () => {
    renderCard({ quantity: '1.00' })

    expect(screen.getByRole('button', { name: 'Aumentar cantidad de Plátano' })).toBeEnabled()
  })

  it('disables both buttons while a request is in flight, to avoid a stacked duplicate tap', async () => {
    let resolveRequest: (product: Product) => void = () => {}
    mockedAdjust.mockReturnValue(
      new Promise<Product>((resolve) => {
        resolveRequest = resolve
      }),
    )
    renderCard({ quantity: '3.00' })

    screen.getByRole('button', { name: 'Aumentar cantidad de Plátano' }).click()

    await waitFor(() => expect(screen.getByRole('button', { name: /aumentar/i })).toBeDisabled())
    expect(screen.getByRole('button', { name: /reducir/i })).toBeDisabled()

    resolveRequest(product({ quantity: '4.00' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /aumentar/i })).toBeEnabled())
  })

  it('shows the failure inline and leaves the displayed quantity untouched', async () => {
    mockedAdjust.mockRejectedValue(new Error('nope'))
    const { onQuantityChanged } = renderCard({ quantity: '3.00' })

    screen.getByRole('button', { name: 'Aumentar cantidad de Plátano' }).click()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(onQuantityChanged).not.toHaveBeenCalled()
    expect(screen.getByText('3 piezas')).toBeInTheDocument()
  })
})
