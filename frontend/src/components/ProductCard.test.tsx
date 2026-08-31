import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductCard } from '@/components/ProductCard'
import type { Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  adjustProductQuantity: vi.fn(),
  setProductIcon: vi.fn(),
}))

const products = await import('@/services/productsService')
const mockedAdjust = vi.mocked(products.adjustProductQuantity)
const mockedSetIcon = vi.mocked(products.setProductIcon)

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
    icon: '\u{1F34C}',
    icon_source: 'lookup',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    days_until_expiry: 5,
    status: 'expiring_soon',
    ...overrides,
  }
}

function renderCard(overrides: Partial<Product> = {}) {
  const onProductChanged = vi.fn()
  render(
    <ul>
      <ProductCard
        product={product(overrides)}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onProductChanged={onProductChanged}
      />
    </ul>,
  )
  return { onProductChanged }
}

describe('ProductCard quantity stepper', () => {
  it('sends +1 and reports the server response back to the list', async () => {
    const updated = product({ quantity: '4.00' })
    mockedAdjust.mockResolvedValue(updated)
    const { onProductChanged } = renderCard({ quantity: '3.00' })

    screen.getByRole('button', { name: 'Aumentar cantidad de Plátano' }).click()

    await waitFor(() => expect(onProductChanged).toHaveBeenCalledWith(updated))
    expect(mockedAdjust).toHaveBeenCalledWith(1, 1)
  })

  it('sends -1 from the "−" button', async () => {
    mockedAdjust.mockResolvedValue(product({ quantity: '2.00' }))
    renderCard({ quantity: '3.00' })

    screen.getByRole('button', { name: 'Reducir cantidad de Plátano' }).click()

    await waitFor(() => expect(mockedAdjust).toHaveBeenCalledWith(1, -1))
  })

  it('hides "−" at quantity 1 rather than disabling it, offering no path to zero', () => {
    renderCard({ quantity: '1.00' })

    expect(screen.queryByRole('button', { name: 'Reducir cantidad de Plátano' })).not.toBeInTheDocument()
    expect(mockedAdjust).not.toHaveBeenCalled()
  })

  it('shows "−" again once the quantity is above 1', () => {
    renderCard({ quantity: '2.00' })

    expect(screen.getByRole('button', { name: 'Reducir cantidad de Plátano' })).toBeInTheDocument()
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
    const { onProductChanged } = renderCard({ quantity: '3.00' })

    screen.getByRole('button', { name: 'Aumentar cantidad de Plátano' }).click()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(onProductChanged).not.toHaveBeenCalled()
    expect(screen.getByText('3 piezas')).toBeInTheDocument()
  })
})

describe('ProductCard icon override', () => {
  it('shows the current icon as a button, not the raw name text alone', () => {
    renderCard({ icon: '\u{1F34C}' })

    expect(screen.getByRole('button', { name: /cambiar icono de Plátano/i })).toHaveTextContent('\u{1F34C}')
  })

  it('clicking the icon opens a grid of common emoji, highlighting the current one', () => {
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))

    const current = screen.getByRole('button', { name: '\u{1F34C}' })
    expect(current).toHaveAttribute('aria-pressed', 'true')
    // Some other option from the grid, to prove it is more than one button.
    expect(screen.getByRole('button', { name: '\u{1F34E}' })).toBeInTheDocument()
  })

  it('tapping a grid option saves it immediately, no separate confirm step', async () => {
    const updated = product({ icon: '\u{1F34E}', icon_source: 'manual' })
    mockedSetIcon.mockResolvedValue(updated)
    const { onProductChanged } = renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: '\u{1F34E}' }))

    await waitFor(() => expect(onProductChanged).toHaveBeenCalledWith(updated))
    expect(mockedSetIcon).toHaveBeenCalledWith(1, '\u{1F34E}')
  })

  it('tapping the current icon again in the grid is a no-op, not a wasted request', () => {
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: '\u{1F34C}' }))

    expect(mockedSetIcon).not.toHaveBeenCalled()
  })

  it('"Otro" reveals a text field prefilled with the current icon, for anything not in the grid', () => {
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))

    expect(screen.getByLabelText('Cambiar icono de Plátano')).toHaveValue('\u{1F34C}')
  })

  it('committing a new icon in "Otro" with Enter sends it and marks the change manual', async () => {
    const updated = product({ icon: '\u{1F9C1}', icon_source: 'manual' })
    mockedSetIcon.mockResolvedValue(updated)
    const { onProductChanged } = renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')
    fireEvent.change(input, { target: { value: '\u{1F9C1}' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onProductChanged).toHaveBeenCalledWith(updated))
    expect(mockedSetIcon).toHaveBeenCalledWith(1, '\u{1F9C1}')
  })

  it('committing on blur works the same as pressing Enter', async () => {
    mockedSetIcon.mockResolvedValue(product({ icon: '\u{1F9C1}', icon_source: 'manual' }))
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')
    fireEvent.change(input, { target: { value: '\u{1F9C1}' } })
    fireEvent.blur(input)

    await waitFor(() => expect(mockedSetIcon).toHaveBeenCalledWith(1, '\u{1F9C1}'))
  })

  it('leaving "Otro" unchanged closes the editor without a request', () => {
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    fireEvent.blur(screen.getByLabelText('Cambiar icono de Plátano'))

    expect(mockedSetIcon).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /cambiar icono de Plátano/i })).toBeInTheDocument()
  })

  it('Escape in "Otro" cancels without saving, even if the field was changed', () => {
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')
    fireEvent.change(input, { target: { value: '\u{1F9C1}' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(mockedSetIcon).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /cambiar icono de Plátano/i })).toHaveTextContent('\u{1F34C}')
  })

  it('an empty "Otro" field closes the editor without a request rather than sending a blank icon', () => {
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(mockedSetIcon).not.toHaveBeenCalled()
  })

  it('"Cerrar" closes the picker without saving', () => {
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar selector de icono' }))

    expect(mockedSetIcon).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Iconos comunes' })).not.toBeInTheDocument()
  })

  it('disables the grid while a selection is being saved', async () => {
    let resolveRequest: (product: Product) => void = () => {}
    mockedSetIcon.mockReturnValue(
      new Promise<Product>((resolve) => {
        resolveRequest = resolve
      }),
    )
    renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: '\u{1F34E}' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '\u{1F34E}' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Otro…' })).toBeDisabled()

    resolveRequest(product({ icon: '\u{1F34E}', icon_source: 'manual' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Iconos comunes' })).not.toBeInTheDocument())
  })

  it('shows the failure inline and leaves the icon showing the old value', async () => {
    mockedSetIcon.mockRejectedValue(new Error('nope'))
    const { onProductChanged } = renderCard({ icon: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: /cambiar icono de Plátano/i }))
    fireEvent.click(screen.getByRole('button', { name: '\u{1F34E}' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(onProductChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /cambiar icono de Plátano/i })).toHaveTextContent('\u{1F34C}')
  })
})
