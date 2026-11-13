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
    spoiled: false,
    consumed_quantity: '0.00',
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

describe('ProductHistory spoiled food — see #145', () => {
  it('marks what was thrown out and only that', async () => {
    mockedHistory.mockResolvedValue([
      product({ id: 1, name: 'Yogur', spoiled: true }),
      product({ id: 2, name: 'Queso', spoiled: false }),
    ])

    renderHistory()

    const yogur = (await screen.findByText('Yogur')).closest('li')
    const queso = screen.getByText('Queso').closest('li')
    expect(yogur).toHaveTextContent('Se echó a perder')
    expect(queso).not.toHaveTextContent('Se echó a perder')
  })

  it('groups by month with a count of each kind, newest first', async () => {
    mockedHistory.mockResolvedValue([
      product({ id: 1, name: 'Yogur', consumed_at: '2026-09-20T15:00:00Z', spoiled: true }),
      product({ id: 2, name: 'Queso', consumed_at: '2026-09-18T15:00:00Z' }),
      product({ id: 3, name: 'Leche', consumed_at: '2026-09-10T15:00:00Z' }),
      product({ id: 4, name: 'Arroz', consumed_at: '2026-08-05T15:00:00Z', spoiled: true }),
    ])

    renderHistory()

    await screen.findByText('Yogur')
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Septiembre de 2026',
      'Agosto de 2026',
    ])
    expect(screen.getByText('2 consumidos · 1 se echó a perder')).toBeInTheDocument()
    expect(screen.getByText('1 se echó a perder')).toBeInTheDocument()
  })

  it('pluralizes the counts', async () => {
    mockedHistory.mockResolvedValue([
      product({ id: 1, consumed_at: '2026-09-20T15:00:00Z', spoiled: true }),
      product({ id: 2, consumed_at: '2026-09-19T15:00:00Z', spoiled: true }),
      product({ id: 3, consumed_at: '2026-09-18T15:00:00Z' }),
    ])

    renderHistory()

    expect(await screen.findByText('1 consumido · 2 se echaron a perder')).toBeInTheDocument()
  })

  it('updates the month count when something is restored', async () => {
    mockedHistory.mockResolvedValue([
      product({ id: 1, name: 'Yogur', consumed_at: '2026-09-20T15:00:00Z', spoiled: true }),
      product({ id: 2, name: 'Queso', consumed_at: '2026-09-18T15:00:00Z' }),
    ])
    mockedRestore.mockResolvedValue(product({ id: 1, consumed_at: null }))

    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar Yogur' }))

    expect(await screen.findByText('1 consumido')).toBeInTheDocument()
  })
})

describe('ProductHistory for something eaten a part at a time — see #172', () => {
  it('shows all that was eaten, not just the last of it', async () => {
    mockedHistory.mockResolvedValue([
      product({ name: 'Yogurt', quantity: '1.00', consumed_quantity: '5.00', unit: 'piezas' }),
    ])

    renderHistory()

    const row = (await screen.findByText('Yogurt')).closest('li')
    expect(row).toHaveTextContent(/^.*6 piezas ·/)
    expect(row).not.toHaveTextContent('1 piezas')
  })

  it('splits what was eaten from what was thrown out', async () => {
    mockedHistory.mockResolvedValue([
      product({ name: 'Yogurt', quantity: '2.00', consumed_quantity: '4.00', unit: 'piezas', spoiled: true }),
    ])

    renderHistory()

    const row = (await screen.findByText('Yogurt')).closest('li')
    expect(row).toHaveTextContent('6 piezas ·')
    expect(row).toHaveTextContent('Consumido: 4 · Se echó a perder: 2')
  })

  it('says only that it was thrown out when none of it was eaten', async () => {
    mockedHistory.mockResolvedValue([product({ name: 'Yogurt', quantity: '6.00', spoiled: true })])

    renderHistory()

    const row = (await screen.findByText('Yogurt')).closest('li')
    expect(row).toHaveTextContent('Se echó a perder')
    expect(row).not.toHaveTextContent('Consumido:')
  })
})
