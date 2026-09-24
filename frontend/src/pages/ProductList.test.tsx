import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductList } from '@/pages/ProductList'
import type { LabelScan, Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  replaceProduct: vi.fn(),
  deleteProduct: vi.fn(),
  adjustProductQuantity: vi.fn(),
  setProductIcon: vi.fn(),
  consumeProduct: vi.fn(),
  listConsumedProducts: vi.fn(),
  restoreProduct: vi.fn(),
  listNameSuggestions: vi.fn(),
}))

vi.mock('@/services/categoriesService', () => ({
  listCategories: vi.fn(),
}))

vi.mock('@/services/tripsService', () => ({
  getCurrentTrip: vi.fn(),
  uploadReceipt: vi.fn(),
  dropTripItem: vi.fn(),
  resolveTripItem: vi.fn(),
}))

vi.mock('@/services/labelScansService', () => ({
  getCurrentLabelScans: vi.fn(),
  queueLabelScan: vi.fn(),
  dropLabelScan: vi.fn(),
  resolveLabelScan: vi.fn(),
  retryLabelScan: vi.fn(),
  labelScanImageUrl: (id: number) => `/api/label-scans/${id}/image`,
}))

const products = await import('@/services/productsService')
const categories = await import('@/services/categoriesService')
const trips = await import('@/services/tripsService')
const labelScans = await import('@/services/labelScansService')
const mockedCurrentLabelScans = vi.mocked(labelScans.getCurrentLabelScans)
const mockedQueueLabelScan = vi.mocked(labelScans.queueLabelScan)

const mockedList = vi.mocked(products.listProducts)
const mockedCreate = vi.mocked(products.createProduct)
const mockedReplace = vi.mocked(products.replaceProduct)
const mockedDelete = vi.mocked(products.deleteProduct)
const mockedConsume = vi.mocked(products.consumeProduct)
const mockedHistory = vi.mocked(products.listConsumedProducts)
const mockedRestore = vi.mocked(products.restoreProduct)
const mockedCategories = vi.mocked(categories.listCategories)
const mockedNameSuggestions = vi.mocked(products.listNameSuggestions)
const mockedCurrentTrip = vi.mocked(trips.getCurrentTrip)
const mockedUploadReceipt = vi.mocked(trips.uploadReceipt)

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
    icon: '\u{1F95B}',
    icon_source: 'lookup',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    consumed_at: null,
    days_until_expiry: 5,
    status: 'expiring_soon',
    ...overrides,
  }
}

/**
 * The product name only, in card order — h2.textContent would also pick up
 * the icon button now prefixed to it, which these tests were never about.
 */
function headingNames(): string[] {
  return screen
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.querySelector('.product-card__name-text')?.textContent ?? '')
}

/** Opens the create form through "+ Agregar" → "Un producto" — see #147. */
async function openCreateForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Agregar' }))
  fireEvent.click(screen.getByRole('button', { name: /^Un producto/ }))
}

/** Opens a product card's details, where Editar, Eliminar and the category
 *  live — see #140. The toggle's accessible name starts with the product's. */
async function expandCard(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`), expanded: false }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedCategories.mockResolvedValue([
    { id: 3, name: 'Lácteos', created_at: '2026-08-29T00:00:00Z' },
  ])
  mockedNameSuggestions.mockResolvedValue([])
  mockedCurrentTrip.mockResolvedValue(null)
  mockedCurrentLabelScans.mockResolvedValue([])
})

describe('ProductList', () => {
  it('renders each product with its details', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })

    render(<ProductList />)

    // Scoped to the list: the filter bar also renders "Refrigerador", as an option.
    const list = within(await screen.findByRole('list'))
    expect(list.getByText('Leche entera')).toBeInTheDocument()
    expect(list.getByText('2 litros')).toBeInTheDocument()
    expect(list.getByText('Refrigerador')).toBeInTheDocument()
    expect(list.getByText('Caduca en 5 días')).toBeInTheDocument()
  })

  it('keeps the order the API returned rather than re-sorting', async () => {
    mockedList.mockResolvedValue({ products: [
      product({ id: 1, name: 'Yogur', days_until_expiry: 1 }),
      product({ id: 2, name: 'Queso', days_until_expiry: 4 }),
      product({ id: 3, name: 'Arroz', days_until_expiry: 90, status: 'fresh' }),
    ], cachedAt: null })

    render(<ProductList />)

    await screen.findByText('Yogur')
    expect(headingNames()).toEqual(['Yogur', 'Queso', 'Arroz'])
  })

  it.each([
    ['fresh' as const, 90],
    ['expiring_soon' as const, 3],
    ['expired' as const, -2],
  ])('marks a %s card so the list can be scanned by colour', async (status, days) => {
    mockedList.mockResolvedValue({ products: [product({ status, days_until_expiry: days })], cachedAt: null })

    render(<ProductList />)

    const card = (await screen.findByText('Leche entera')).closest('li')
    expect(card).toHaveClass(`product-card--${status}`)
  })

  it('labels a product with no category instead of leaving a gap', async () => {
    mockedList.mockResolvedValue({ products: [product({ category: null })], cachedAt: null })

    render(<ProductList />)
    await expandCard('Leche entera')

    expect(screen.getByText('Sin categoría')).toBeInTheDocument()
  })

  it('invites the user to start when there is nothing yet', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })

    render(<ProductList />)

    expect(await screen.findByText('Todavía no hay nada registrado.')).toBeInTheDocument()
  })

  it('shows a readable message and a retry when the request fails', async () => {
    mockedList.mockRejectedValue(new Error('boom'))

    render(<ProductList />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    // Not this failure's cause — no reauth link offered for it.
    expect(screen.queryByText(/reautentícate/i)).not.toBeInTheDocument()
  })

  it('offers a same-window Cloudflare Access reauth link when the backend looks unreachable', async () => {
    // Same window, deliberately: the PWA is the primary way this app is
    // used, and an installed PWA typically has nowhere to open a second tab
    // — see ProductList.tsx's own comment. A target="_blank" here would
    // leave the user stuck switching between two separate apps instead of
    // just navigating away and back.
    mockedList.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))

    render(<ProductList />)

    const link = await screen.findByRole('link', { name: /reautentícate aquí/i })
    expect(link).toHaveAttribute('href', `${window.location.origin}/api/reauth`)
    expect(link).not.toHaveAttribute('target')
  })
})

describe('creating a product', () => {
  it('sends the form and reloads the list', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedCreate.mockResolvedValue(product())

    render(<ProductList />)
    await openCreateForm()

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Huevos' } })
    fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2026-09-10' } })
    fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'piezas' } })
    fireEvent.change(screen.getByLabelText('Dónde está'), { target: { value: 'fridge' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith({
      name: 'Huevos',
      category_id: null,
      quantity: '12',
      unit: 'piezas',
      expires_at: '2026-09-10',
      location: 'fridge',
      notes: null,
    })
    // Two calls: the initial load and the reload after saving.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
  })

  it('sends empty optional fields as null rather than empty strings', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedCreate.mockResolvedValue(product())

    render(<ProductList />)
    await openCreateForm()
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Sal' } })
    fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2027-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ unit: null, notes: null, category_id: null })
  })

  it('keeps the form open and explains why when saving fails', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    const { AxiosError, AxiosHeaders } = await import('axios')
    const failure = new AxiosError('Request failed')
    failure.response = {
      data: { detail: 'Category 9999 does not exist' },
      status: 422,
      statusText: '',
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    }
    mockedCreate.mockRejectedValue(failure)

    render(<ProductList />)
    await openCreateForm()
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Huevos' } })
    fireEvent.change(screen.getByLabelText('Caduca el'), { target: { value: '2026-09-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Category 9999 does not exist')
    expect(screen.getByLabelText('Nombre')).toHaveValue('Huevos')
  })
})

describe('editing a product', () => {
  it('opens prefilled with the product and replaces it on save', async () => {
    const existing = product({
      id: 7,
      name: 'Yogur griego',
      quantity: '4.00',
      unit: 'piezas',
      notes: 'abierto',
      category_id: 3,
      category: { id: 3, name: 'Lácteos', created_at: '2026-08-29T00:00:00Z' },
    })
    mockedList.mockResolvedValue({ products: [existing], cachedAt: null })
    mockedReplace.mockResolvedValue(existing)

    render(<ProductList />)
    await expandCard('Yogur griego')
    fireEvent.click(screen.getByRole('button', { name: 'Editar Yogur griego' }))

    // Scoped to the dialog: the filter bar behind it also has a "Categoría" control.
    const form = within(screen.getByRole('dialog'))
    expect(form.getByLabelText('Nombre')).toHaveValue('Yogur griego')
    // "4.00" from the API must not show up as-is in a number field.
    expect(form.getByLabelText('Cantidad')).toHaveValue(4)
    expect(form.getByLabelText('Notas')).toHaveValue('abierto')
    expect(form.getByLabelText('Categoría')).toHaveValue('3')

    fireEvent.change(form.getByLabelText('Nombre'), { target: { value: 'Yogur natural' } })
    fireEvent.click(form.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedReplace).toHaveBeenCalledTimes(1))
    expect(mockedReplace).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'Yogur natural' }))
  })
})

describe('deleting a product', () => {
  it('asks before deleting and does nothing on cancel', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })

    render(<ProductList />)
    await expandCard('Leche entera')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Leche entera' }))

    expect(screen.getByText(/¿Seguro que quieres eliminar "Leche entera"\?/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(mockedDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes and reloads once confirmed', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })
    mockedDelete.mockResolvedValue(undefined)

    render(<ProductList />)
    await expandCard('Leche entera')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Leche entera' }))
    // Exactly "Eliminar" — the card's button is labelled "Eliminar Leche entera".
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(1))
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
  })
})

describe('consuming a product', () => {
  it('removes the card from the list without a full reload', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })
    mockedConsume.mockResolvedValue(product({ consumed_at: '2026-08-31T12:00:00Z' }))

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar Leche entera como consumido' }))

    await waitFor(() => expect(mockedConsume).toHaveBeenCalledWith(1))
    expect(screen.queryByText('Leche entera')).not.toBeInTheDocument()
    // No dialog opens for this action, and nothing refetches the list — the
    // row leaving is proof enough, a second listProducts call would mean it
    // took the reload path instead of the local removal one.
    expect(mockedList).toHaveBeenCalledTimes(1)
  })

  it('offers to undo it — see #143', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })
    mockedConsume.mockResolvedValue(product({ consumed_at: '2026-08-31T12:00:00Z' }))
    mockedRestore.mockResolvedValue(product())

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar Leche entera como consumido' }))

    expect(await screen.findByText('Consumido: Leche entera')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }))

    await waitFor(() => expect(mockedRestore).toHaveBeenCalledWith(1))
    // Back from the server through a reload, not re-inserted locally.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Consumido: Leche entera')).not.toBeInTheDocument())
  })
})

describe('viewing history', () => {
  it('lists consumed products and restores one back to the active list', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedHistory.mockResolvedValue([
      product({ id: 9, name: 'Yogur caducado', consumed_at: '2026-08-30T09:00:00Z' }),
    ])
    mockedRestore.mockResolvedValue(product({ id: 9, name: 'Yogur caducado', consumed_at: null }))

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Historial' }))

    expect(await screen.findByText('Yogur caducado')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar Yogur caducado' }))

    await waitFor(() => expect(mockedRestore).toHaveBeenCalledWith(9))
    // Restoring a history row must refresh the active list behind the dialog,
    // same as SettingsDialog's onIconsReassigned — otherwise the product
    // reappears in history's own list but stays invisible in the fridge view
    // until something unrelated happens to trigger a reload.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
  })

  it('shows an empty message when nothing has been consumed yet', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedHistory.mockResolvedValue([])

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Historial' }))

    expect(await screen.findByText('Todavía no has marcado nada como consumido.')).toBeInTheDocument()
  })
})

describe('scanning a receipt', () => {
  function selectReceipt(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]')
    if (!input) throw new Error('receipt file input not found')
    const file = new File(['fake'], 'receipt.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('uploads the photo and opens the checklist on success', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedUploadReceipt.mockResolvedValue({
      id: 1,
      created_at: '2026-09-01T00:00:00Z',
      stated_item_count: null,
      items: [
        { id: 1, name: 'Nopal limpio', quantity: '1.00', is_food: true, resolved_at: null, product_id: null },
      ],
      counted_quantity: '1.00',
      reconciled: null,
    })

    const { container } = render(<ProductList />)
    await screen.findByRole('button', { name: 'Agregar' })
    selectReceipt(container)

    await waitFor(() => expect(mockedUploadReceipt).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Nopal limpio')).toBeInTheDocument()
  })

  it('says the receipt is being read while the upload runs — see #147', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedUploadReceipt.mockReturnValue(new Promise(() => {}))

    const { container } = render(<ProductList />)
    await screen.findByRole('button', { name: 'Agregar' })
    selectReceipt(container)

    expect(await screen.findByRole('status')).toHaveTextContent('Leyendo recibo…')
  })

  it('shows a readable error when the upload fails', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedUploadReceipt.mockRejectedValue(new Error('boom'))

    const { container } = render(<ProductList />)
    await screen.findByRole('button', { name: 'Agregar' })
    selectReceipt(container)

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
  })

  it('shows a banner for a trip left over from a previous visit', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedCurrentTrip.mockResolvedValue({
      id: 4,
      created_at: '2026-08-31T00:00:00Z',
      stated_item_count: null,
      items: [
        { id: 1, name: 'Nopal limpio', quantity: '1.00', is_food: true, resolved_at: null, product_id: null },
        { id: 2, name: 'Plátano', quantity: '2.00', is_food: true, resolved_at: null, product_id: null },
      ],
      counted_quantity: '3.00',
      reconciled: null,
    })

    render(<ProductList />)

    const banner = await screen.findByRole('button', { name: /recibo pendiente/i })
    expect(banner).toHaveTextContent('2 productos')

    fireEvent.click(banner)

    expect(await screen.findByText('Plátano')).toBeInTheDocument()
  })

  it('keeps the dialog on its own receipt when finishing it surfaces an older one — see #153', async () => {
    const pendingLine = { quantity: '1.00', is_food: true, resolved_at: null, product_id: null }
    const olderTrip = {
      id: 4,
      created_at: '2026-09-21T18:00:00Z',
      stated_item_count: null,
      items: [{ id: 1, name: 'Espinacas', ...pendingLine }],
      counted_quantity: '1.00',
      reconciled: null,
    }
    mockedList.mockResolvedValue({ products: [product({ id: 5, name: 'Espinacas' })], cachedAt: null })
    mockedCurrentTrip.mockResolvedValue({
      ...olderTrip,
      id: 5,
      created_at: '2026-09-24T18:00:00Z',
      items: [{ id: 10, name: 'Espinacas', ...pendingLine }],
    })
    vi.mocked(trips.resolveTripItem).mockResolvedValue({
      id: 10,
      name: 'Espinacas',
      quantity: '1.00',
      is_food: true,
      resolved_at: '2026-09-24T18:05:00Z',
      product_id: 5,
    })

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: /recibo pendiente \(24 sep\)/i }))
    // Once this receipt is done, "current" is the older duplicate scan.
    mockedCurrentTrip.mockResolvedValue(olderTrip)

    fireEvent.click(screen.getByRole('button', { name: 'Vincular a producto existente' }))
    fireEvent.change(screen.getByLabelText('Vincular Espinacas a un producto existente'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText('Ya no quedan productos pendientes en este recibo.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recibo del 24 sep' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))

    expect(await screen.findByRole('button', { name: /recibo pendiente \(21 sep\)/i })).toBeInTheDocument()
  })

  it('does not show a banner once every item in the leftover trip is already resolved', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedCurrentTrip.mockResolvedValue({
      id: 4,
      created_at: '2026-08-31T00:00:00Z',
      stated_item_count: null,
      items: [
        {
          id: 1,
          name: 'Nopal limpio',
          quantity: '1.00',
          is_food: true,
          resolved_at: '2026-08-31T00:05:00Z',
          product_id: 9,
        },
      ],
      counted_quantity: '1.00',
      reconciled: null,
    })

    render(<ProductList />)
    await screen.findByRole('button', { name: 'Agregar' })

    expect(screen.queryByRole('button', { name: /recibo pendiente/i })).not.toBeInTheDocument()
  })
})

describe('the overlay', () => {
  it('closes on Escape', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })

    render(<ProductList />)
    await openCreateForm()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})


describe('filtering and sorting', () => {
  const pantry = [
    product({ id: 1, name: 'Yogur', location: 'fridge', status: 'expired', days_until_expiry: -2 }),
    product({ id: 2, name: 'Arroz', location: 'pantry', status: 'fresh', days_until_expiry: 90 }),
    product({ id: 3, name: 'Guisantes', location: 'freezer', status: 'fresh', days_until_expiry: 120 }),
  ]

  function chip(name: string | RegExp) {
    return screen.getByRole('button', { name })
  }

  it('narrows the list by location', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.click(chip('Alacena'))

    expect(headingNames()).toEqual(['Arroz'])
    expect(chip('Alacena')).toHaveAttribute('aria-pressed', 'true')
  })

  it('narrows the list by status, and a second tap undoes it', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.click(chip(/^Vencidos/))
    expect(headingNames()).toEqual(['Yogur'])

    fireEvent.click(chip(/^Vencidos/))
    expect(headingNames()).toHaveLength(3)
  })

  it('counts what needs attention on the status chips — see #141', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    expect(chip('Vencidos, 1')).toBeInTheDocument()
    // Nothing is expiring soon: no count rather than a zero.
    expect(chip('Por caducar')).toBeInTheDocument()
  })

  it('combines filters instead of replacing them', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.click(chip(/^Vencidos/))
    fireEvent.click(chip('Alacena'))

    // Either one alone would match something; both together match nothing.
    expect(screen.getByText('Ningún producto coincide con los filtros.')).toBeInTheDocument()
  })

  it('finds a product by name, ignoring case and accents', async () => {
    mockedList.mockResolvedValue({
      products: [...pantry, product({ id: 4, name: 'Jamón de pavo', status: 'fresh', days_until_expiry: 10 })],
      cachedAt: null,
    })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar producto' }), { target: { value: 'JAMON' } })

    expect(headingNames()).toEqual(['Jamón de pavo'])
    expect(screen.getByText('1 de 4')).toBeInTheDocument()
  })

  it('keeps category and sort behind "Más filtros"', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')
    expect(screen.queryByLabelText('Ordenar por')).not.toBeInTheDocument()

    fireEvent.click(chip('Más filtros'))

    expect(screen.getByLabelText('Ordenar por')).toBeInTheDocument()
    expect(screen.getByLabelText('Categoría')).toBeInTheDocument()
  })

  it('reorders by name without refetching', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.click(chip('Más filtros'))
    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'name' } })

    expect(headingNames()).toEqual([
      'Arroz',
      'Guisantes',
      'Yogur',
    ])
    // Filtering and sorting are local; the API is called once, on mount.
    expect(mockedList).toHaveBeenCalledTimes(1)
  })

  it('shows how many matched and restores everything on clear', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')
    // No count while nothing is filtered.
    expect(screen.queryByText('1 de 3')).not.toBeInTheDocument()

    fireEvent.click(chip('Alacena'))
    expect(screen.getByText('1 de 3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }))

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
  })

  it('distinguishes "no matches" from an empty pantry', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.click(chip('Por caducar'))

    expect(screen.getByText('Ningún producto coincide con los filtros.')).toBeInTheDocument()
    // Telling someone with a full pantry to "add their first purchase" is wrong.
    expect(screen.queryByText('Todavía no hay nada registrado.')).not.toBeInTheDocument()
  })
})

describe('offline data', () => {
  it('says so when the list came from the cache', async () => {
    mockedList.mockResolvedValue({
      products: [product()],
      cachedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })

    render(<ProductList />)

    expect(await screen.findByRole('status')).toHaveTextContent('mostrando datos guardados hace 2 horas')
  })

  it('says nothing when the list is current', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })

    render(<ProductList />)

    await screen.findByText('Leche entera')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('recovering from a stale list', () => {
  it('refetches when the browser reports it is back online', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: new Date() })

    render(<ProductList />)
    await screen.findByText('Leche entera')
    expect(mockedList).toHaveBeenCalledTimes(1)

    fireEvent(window, new Event('online'))

    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
  })

  it('refetches when the tab becomes visible again', async () => {
    // The trigger that actually fires in the real path: the `online` event
    // misses a device that believes it is connected behind a broken network.
    mockedList.mockResolvedValue({ products: [product()], cachedAt: new Date() })

    render(<ProductList />)
    await screen.findByText('Leche entera')
    expect(mockedList).toHaveBeenCalledTimes(1)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
  })

  it('does not refetch when the tab is being hidden', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Leche entera')

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))

    // Refetching on the way out wastes a request nobody is waiting for.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockedList).toHaveBeenCalledTimes(1)
  })
})

describe('queuing label photos', () => {
  function labelScan(overrides: Partial<LabelScan> = {}): LabelScan {
    return {
      id: 1,
      created_at: '2026-09-22T00:00:00Z',
      status: 'read',
      name: 'Yogur natural',
      expires_at: '2026-10-15',
      quantity: null,
      unit: null,
      resolved_at: null,
      product_id: null,
      ...overrides,
    }
  }

  function selectLabels(container: HTMLElement, count: number) {
    const input = container.querySelector('input[type="file"][multiple]')
    if (!input) throw new Error('label file input not found')
    const files = Array.from({ length: count }, (_, i) => new File(['fake'], `label${i}.jpg`, { type: 'image/jpeg' }))
    fireEvent.change(input, { target: { files } })
  }

  it('shows a banner for photos left from a previous visit', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedCurrentLabelScans.mockResolvedValue([
      labelScan({ id: 1, status: 'pending', name: null }),
      labelScan({ id: 2 }),
      labelScan({ id: 3, status: 'failed', name: null }),
    ])

    render(<ProductList />)

    expect(
      await screen.findByRole('button', { name: 'Etiquetas: 1 leyendo, 2 por revisar — revisar' }),
    ).toBeInTheDocument()
  })

  it('opens the queue from its banner', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedCurrentLabelScans.mockResolvedValue([labelScan()])

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: /^Etiquetas: 1 por revisar/ }))

    expect(screen.getByRole('heading', { name: 'Etiquetas' })).toBeInTheDocument()
    expect(screen.getByText('Yogur natural')).toBeInTheDocument()
  })

  it('uploads every chosen photo, one request each', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedQueueLabelScan.mockResolvedValue(labelScan({ status: 'pending', name: null }))

    const { container } = render(<ProductList />)
    await screen.findByRole('button', { name: 'Agregar' })
    selectLabels(container, 3)

    await waitFor(() => expect(mockedQueueLabelScan).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.queryByText(/Subiendo etiquetas/)).not.toBeInTheDocument())
  })

  it('says how many photos failed to upload', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedQueueLabelScan
      .mockResolvedValueOnce(labelScan({ status: 'pending' }))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))

    const { container } = render(<ProductList />)
    await screen.findByRole('button', { name: 'Agregar' })
    selectLabels(container, 3)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron subir 2 fotos.')
  })

  it('keeps checking on photos still being read, and stops once none are', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      mockedList.mockResolvedValue({ products: [], cachedAt: null })
      mockedCurrentLabelScans
        .mockResolvedValueOnce([labelScan({ status: 'pending', name: null })])
        .mockResolvedValue([labelScan()])

      render(<ProductList />)
      await screen.findByRole('button', { name: /^Etiquetas: 1 leyendo/ })

      await vi.advanceTimersByTimeAsync(3000)

      expect(await screen.findByRole('button', { name: /^Etiquetas: 1 por revisar/ })).toBeInTheDocument()
      const calls = mockedCurrentLabelScans.mock.calls.length
      await vi.advanceTimersByTimeAsync(9000)
      expect(mockedCurrentLabelScans).toHaveBeenCalledTimes(calls)
    } finally {
      vi.useRealTimers()
    }
  })
})
