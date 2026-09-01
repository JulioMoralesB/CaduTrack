import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReceiptTripDialog } from '@/components/ReceiptTripDialog'
import type { Product, ShoppingTrip, ShoppingTripItem } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  createProduct: vi.fn(),
  replaceProduct: vi.fn(),
}))

vi.mock('@/services/visionService', () => ({
  extractLabel: vi.fn(),
}))

vi.mock('@/services/tripsService', () => ({
  dropTripItem: vi.fn(),
  resolveTripItem: vi.fn(),
}))

const products = await import('@/services/productsService')
const trips = await import('@/services/tripsService')
const mockedCreate = vi.mocked(products.createProduct)
const mockedDrop = vi.mocked(trips.dropTripItem)
const mockedResolve = vi.mocked(trips.resolveTripItem)

function tripItem(overrides: Partial<ShoppingTripItem> = {}): ShoppingTripItem {
  return {
    id: 1,
    name: 'Nopal limpio',
    quantity: '1.00',
    is_food: true,
    resolved_at: null,
    product_id: null,
    ...overrides,
  }
}

function trip(overrides: Partial<ShoppingTrip> = {}): ShoppingTrip {
  return {
    id: 1,
    created_at: '2026-09-01T00:00:00Z',
    stated_item_count: null,
    items: [tripItem()],
    counted_quantity: '1.00',
    reconciled: null,
    ...overrides,
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 5,
    name: 'Nopal limpio',
    category_id: null,
    quantity: '1.00',
    unit: null,
    expires_at: '2026-09-10',
    location: 'fridge',
    notes: null,
    category: null,
    icon: '\u{1F955}',
    icon_source: 'lookup',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    consumed_at: null,
    days_until_expiry: 9,
    status: 'fresh',
    ...overrides,
  }
}

function renderDialog(overrides: Partial<ShoppingTrip> = {}, products: Product[] = []) {
  const onClose = vi.fn()
  const onTripChanged = vi.fn()
  render(
    <ReceiptTripDialog
      trip={trip(overrides)}
      categories={[]}
      products={products}
      onClose={onClose}
      onTripChanged={onTripChanged}
    />,
  )
  return { onClose, onTripChanged }
}

/** ProductForm's own required fields — filling only what this dialog does
 *  not already prefill from the trip item. */
function fillDateAndSubmit() {
  fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2026-09-10' } })
  fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReceiptTripDialog review', () => {
  it('shows every pending item pre-ticked by is_food', () => {
    renderDialog({
      items: [tripItem({ id: 1, name: 'Nopal limpio', is_food: true }), tripItem({ id: 2, name: 'Jabón Grisi', is_food: false })],
    })

    const nopal = screen.getByRole('checkbox', { name: /nopal limpio/i })
    const jabon = screen.getByRole('checkbox', { name: /jabón grisi/i })
    expect(nopal).toBeChecked()
    expect(jabon).not.toBeChecked()
  })

  it('toggles a tick on click', () => {
    renderDialog({ items: [tripItem({ is_food: false })] })

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
  })

  it('warns when the reconciliation does not match', () => {
    renderDialog({ reconciled: false, counted_quantity: '3.00', stated_item_count: 5 })

    expect(screen.getByRole('alert')).toHaveTextContent('3.00')
    expect(screen.getByRole('alert')).toHaveTextContent('5')
  })

  it('shows nothing extra when there is nothing to reconcile against', () => {
    renderDialog({ reconciled: null })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not show already-resolved items', () => {
    renderDialog({
      items: [
        tripItem({ id: 1, name: 'Nopal limpio' }),
        tripItem({ id: 2, name: 'Jabón Grisi', resolved_at: '2026-09-01T00:00:00Z' }),
      ],
    })

    expect(screen.getByText('Nopal limpio')).toBeInTheDocument()
    expect(screen.queryByText('Jabón Grisi')).not.toBeInTheDocument()
  })
})

describe('ReceiptTripDialog duplicate flagging', () => {
  // Real, unmocked "now" — see ProductForm.test.tsx's own duplicate-check
  // block for why this avoids fake timers entirely.
  function createdToday(): string {
    return new Date().toISOString()
  }

  it('starts a same-day match unticked and badged, regardless of is_food', () => {
    const existing = product({ name: 'Nopal limpio', created_at: createdToday() })
    renderDialog({ items: [tripItem({ name: 'Nopal limpio', is_food: true })] }, [existing])

    expect(screen.getByRole('checkbox', { name: /nopal limpio/i })).not.toBeChecked()
    expect(screen.getByText('Ya lo tienes hoy')).toBeInTheDocument()
  })

  it('still ticks a same-name item from a previous day', () => {
    const existing = product({ name: 'Nopal limpio', created_at: '2026-08-20T00:00:00Z' })
    renderDialog({ items: [tripItem({ name: 'Nopal limpio', is_food: true })] }, [existing])

    expect(screen.getByRole('checkbox', { name: /nopal limpio/i })).toBeChecked()
    expect(screen.queryByText('Ya lo tienes hoy')).not.toBeInTheDocument()
  })

  it('can still be re-ticked — the flag is a default, not a lock', () => {
    const existing = product({ name: 'Nopal limpio', created_at: createdToday() })
    renderDialog({ items: [tripItem({ name: 'Nopal limpio', is_food: true })] }, [existing])

    const checkbox = screen.getByRole('checkbox', { name: /nopal limpio/i })
    fireEvent.click(checkbox)

    expect(checkbox).toBeChecked()
  })
})

describe('ReceiptTripDialog continue', () => {
  it('drops every unticked item and notifies the parent', async () => {
    mockedDrop.mockResolvedValue(tripItem({ resolved_at: '2026-09-01T00:00:00Z' }))
    const { onTripChanged } = renderDialog({ items: [tripItem({ is_food: false })] })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await waitFor(() => expect(mockedDrop).toHaveBeenCalledWith(1, 1))
    expect(onTripChanged).toHaveBeenCalled()
  })

  it('does not drop a ticked item', async () => {
    mockedCreate.mockReturnValue(new Promise(() => {})) // leave the add phase pending
    renderDialog({ items: [tripItem({ is_food: true })] })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toBeInTheDocument())
    expect(mockedDrop).not.toHaveBeenCalled()
  })

  it('opens ProductForm pre-filled with the first ticked item, showing how many remain', async () => {
    mockedCreate.mockReturnValue(new Promise(() => {}))
    renderDialog({
      items: [
        tripItem({ id: 1, name: 'Nopal limpio', quantity: '1.00', is_food: true }),
        tripItem({ id: 2, name: 'Plátano', quantity: '3.00', is_food: true }),
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(await screen.findByText('Agregar producto (quedan 2)')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio')
    expect(screen.getByLabelText('Cantidad')).toHaveValue(1)
  })

  it('goes straight to the done screen when nothing was ticked', async () => {
    mockedDrop.mockResolvedValue(tripItem({ resolved_at: '2026-09-01T00:00:00Z' }))
    renderDialog({ items: [tripItem({ is_food: false })] })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(await screen.findByText('Listo — se procesó todo el recibo.')).toBeInTheDocument()
  })
})

describe('ReceiptTripDialog adding', () => {
  it('resolves the item once the product is saved, then advances to the next one', async () => {
    mockedCreate.mockResolvedValue(product({ id: 5 }))
    mockedResolve.mockResolvedValue(tripItem({ id: 1, resolved_at: '2026-09-01T00:00:00Z', product_id: 5 }))
    const { onTripChanged } = renderDialog({
      items: [
        tripItem({ id: 1, name: 'Nopal limpio', is_food: true }),
        tripItem({ id: 2, name: 'Plátano', is_food: true }),
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByText('Agregar producto (quedan 2)')

    fillDateAndSubmit()

    await waitFor(() => expect(mockedResolve).toHaveBeenCalledWith(1, 1, 5))
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Plátano')
    expect(onTripChanged).toHaveBeenCalled()
  })

  it('advances without resolving when the user cancels a step', async () => {
    renderDialog({
      items: [
        tripItem({ id: 1, name: 'Nopal limpio', is_food: true }),
        tripItem({ id: 2, name: 'Plátano', is_food: true }),
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue('Nopal limpio'))

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(await screen.findByLabelText('Nombre')).toHaveValue('Plátano')
    expect(mockedResolve).not.toHaveBeenCalled()
  })

  it('shows the done screen after the last item, and closing keeps a skipped item pending', async () => {
    renderDialog({ items: [tripItem({ id: 1, name: 'Nopal limpio', is_food: true })] })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(
      await screen.findByText(
        'Los productos que agregaste ya están en tu lista. Los que dejaste pendientes seguirán apareciendo aquí.',
      ),
    ).toBeInTheDocument()
  })

  it('closes the whole dialog from the done screen', async () => {
    mockedDrop.mockResolvedValue(tripItem({ resolved_at: '2026-09-01T00:00:00Z' }))
    const { onClose } = renderDialog({ items: [tripItem({ is_food: false })] })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByText('Listo — se procesó todo el recibo.')

    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('falls back to the review screen on a resolve failure, so the error is somewhere visible', async () => {
    // The product itself was already created by this point — only the
    // bookkeeping link failed. Advancing straight to the next item's own
    // ProductForm would leave this error with nowhere in the tree that
    // ever renders it; the review screen is the one place in this dialog
    // that does, regardless of which item comes next.
    mockedCreate.mockResolvedValue(product({ id: 5 }))
    mockedResolve.mockRejectedValue(new Error('nope'))
    renderDialog({
      items: [
        tripItem({ id: 1, name: 'Nopal limpio', is_food: true }),
        tripItem({ id: 2, name: 'Plátano', is_food: true }),
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByText('Agregar producto (quedan 2)')

    fillDateAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    // Both items are back on the checklist — the one that failed and the
    // one never reached yet — rather than silently losing either.
    expect(screen.getByText('Nopal limpio')).toBeInTheDocument()
    expect(screen.getByText('Plátano')).toBeInTheDocument()
  })
})
