import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductList } from '@/pages/ProductList'
import type { Product } from '@/services/types'

vi.mock('@/services/productsService', () => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  replaceProduct: vi.fn(),
  deleteProduct: vi.fn(),
}))

vi.mock('@/services/categoriesService', () => ({
  listCategories: vi.fn(),
}))

const products = await import('@/services/productsService')
const categories = await import('@/services/categoriesService')

const mockedList = vi.mocked(products.listProducts)
const mockedCreate = vi.mocked(products.createProduct)
const mockedReplace = vi.mocked(products.replaceProduct)
const mockedDelete = vi.mocked(products.deleteProduct)
const mockedCategories = vi.mocked(categories.listCategories)

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

beforeEach(() => {
  vi.clearAllMocks()
  mockedCategories.mockResolvedValue([
    { id: 3, name: 'Lácteos', created_at: '2026-08-29T00:00:00Z' },
  ])
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
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(names).toEqual(['Yogur', 'Queso', 'Arroz'])
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

    expect(await screen.findByText('Sin categoría')).toBeInTheDocument()
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
  })
})

describe('creating a product', () => {
  it('sends the form and reloads the list', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })
    mockedCreate.mockResolvedValue(product())

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar producto' }))

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
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar producto' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar producto' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Yogur griego' }))

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
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Leche entera' }))

    expect(screen.getByText(/¿Seguro que quieres eliminar "Leche entera"\?/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(mockedDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes and reloads once confirmed', async () => {
    mockedList.mockResolvedValue({ products: [product()], cachedAt: null })
    mockedDelete.mockResolvedValue(undefined)

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Leche entera' }))
    // Exactly "Eliminar" — the card's button is labelled "Eliminar Leche entera".
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(1))
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2))
  })
})

describe('the overlay', () => {
  it('closes on Escape', async () => {
    mockedList.mockResolvedValue({ products: [], cachedAt: null })

    render(<ProductList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar producto' }))
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

  it('narrows the list by location', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.change(screen.getByLabelText('Ubicación'), { target: { value: 'pantry' } })

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Arroz'])
  })

  it('narrows the list by status', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'expired' } })

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Yogur'])
  })

  it('combines filters instead of replacing them', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'fresh' } })
    fireEvent.change(screen.getByLabelText('Ubicación'), { target: { value: 'freezer' } })

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Guisantes'])
  })

  it('reorders by name without refetching', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'name' } })

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
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

    fireEvent.change(screen.getByLabelText('Ubicación'), { target: { value: 'pantry' } })
    expect(screen.getByText('1 de 3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }))

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
  })

  it('distinguishes "no matches" from an empty pantry', async () => {
    mockedList.mockResolvedValue({ products: pantry, cachedAt: null })

    render(<ProductList />)
    await screen.findByText('Yogur')

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'expiring_soon' } })

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
