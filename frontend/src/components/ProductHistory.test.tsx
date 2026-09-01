import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductHistory } from '@/components/ProductHistory'
import type { Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  listConsumedProducts: vi.fn(),
  restoreProduct: vi.fn(),
}))

const products = await import('@/services/productsService')
const mockedHistory = vi.mocked(products.listConsumedProducts)
const mockedRestore = vi.mocked(products.restoreProduct)

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Yogur',
    category_id: null,
    quantity: '1.00',
    unit: null,
    expires_at: '2026-08-25',
    location: 'fridge',
    notes: null,
    category: null,
    icon: '\u{1F95B}',
    icon_source: 'lookup',
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    consumed_at: '2026-08-24T15:30:00Z',
    days_until_expiry: -6,
    status: 'expired',
    ...overrides,
  }
}

function renderHistory() {
  const onClose = vi.fn()
  const onRestored = vi.fn()
  render(<ProductHistory onClose={onClose} onRestored={onRestored} />)
  return { onClose, onRestored }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProductHistory', () => {
  it('lists every consumed product with its quantity', async () => {
    mockedHistory.mockResolvedValue([product({ name: 'Yogur', quantity: '2.00' })])

    renderHistory()

    expect(await screen.findByText('Yogur')).toBeInTheDocument()
    expect(screen.getByText(/^2 ·/)).toBeInTheDocument()
  })

  it('shows an empty message when nothing has been consumed', async () => {
    mockedHistory.mockResolvedValue([])

    renderHistory()

    expect(await screen.findByText('Todavía no has marcado nada como consumido.')).toBeInTheDocument()
  })

  it('shows a readable error when the request fails', async () => {
    mockedHistory.mockRejectedValue(new Error('boom'))

    renderHistory()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
  })

  it('restores a product and removes it from this list', async () => {
    mockedHistory.mockResolvedValue([product({ id: 5, name: 'Queso' })])
    mockedRestore.mockResolvedValue(product({ id: 5, name: 'Queso', consumed_at: null }))
    const { onRestored } = renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Queso' }))

    await waitFor(() => expect(mockedRestore).toHaveBeenCalledWith(5))
    await waitFor(() => expect(screen.queryByText('Queso')).not.toBeInTheDocument())
    expect(onRestored).toHaveBeenCalled()
  })

  it('shows the failure inline and leaves the row in place', async () => {
    mockedHistory.mockResolvedValue([product({ id: 5, name: 'Queso' })])
    mockedRestore.mockRejectedValue(new Error('nope'))
    const { onRestored } = renderHistory()

    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Queso' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(screen.getByText('Queso')).toBeInTheDocument()
    expect(onRestored).not.toHaveBeenCalled()
  })
})
