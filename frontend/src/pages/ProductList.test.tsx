import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProductList } from '@/pages/ProductList'
import type { Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  listProducts: vi.fn(),
}))

const { listProducts } = await import('@/services/productsService')
const mockedList = vi.mocked(listProducts)

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Leche entera',
    category_id: null,
    quantity: '2.00',
    unit: 'litros',
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

describe('ProductList', () => {
  it('renders each product with its details', async () => {
    mockedList.mockResolvedValue([product()])

    render(<ProductList />)

    expect(await screen.findByText('Leche entera')).toBeInTheDocument()
    expect(screen.getByText('2 litros')).toBeInTheDocument()
    expect(screen.getByText('Refrigerador')).toBeInTheDocument()
    expect(screen.getByText('Caduca en 5 días')).toBeInTheDocument()
  })

  it('keeps the order the API returned rather than re-sorting', async () => {
    mockedList.mockResolvedValue([
      product({ id: 1, name: 'Yogur', days_until_expiry: 1 }),
      product({ id: 2, name: 'Queso', days_until_expiry: 4 }),
      product({ id: 3, name: 'Arroz', days_until_expiry: 90, status: 'fresh' }),
    ])

    render(<ProductList />)

    const names = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent)
    expect(names).toEqual(['Yogur', 'Queso', 'Arroz'])
  })

  it('marks each card with its status so the list can be scanned', async () => {
    mockedList.mockResolvedValue([product({ status: 'expired', days_until_expiry: -2 })])

    render(<ProductList />)

    const card = (await screen.findByText('Leche entera')).closest('li')
    expect(card).toHaveClass('product-card--expired')
  })

  it('labels a product with no category instead of leaving a gap', async () => {
    mockedList.mockResolvedValue([product({ category: null })])

    render(<ProductList />)

    expect(await screen.findByText('Sin categoría')).toBeInTheDocument()
  })

  it('invites the user to start when there is nothing yet', async () => {
    mockedList.mockResolvedValue([])

    render(<ProductList />)

    expect(await screen.findByText('Todavía no hay nada registrado.')).toBeInTheDocument()
  })

  it('shows a readable message and a retry when the request fails', async () => {
    mockedList.mockRejectedValue(new Error('boom'))

    render(<ProductList />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
