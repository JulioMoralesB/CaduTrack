import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CategoryManager } from '@/components/CategoryManager'
import type { Category, Product } from '@/services/types'

vi.mock('@/services/categoriesService', () => ({
  createCategory: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))

const service = await import('@/services/categoriesService')
const mockedCreate = vi.mocked(service.createCategory)
const mockedRename = vi.mocked(service.renameCategory)
const mockedDelete = vi.mocked(service.deleteCategory)

const carnes: Category = { id: 1, name: 'Carnes', created_at: '2026-08-29T00:00:00Z' }
const frutas: Category = { id: 2, name: 'Frutas', created_at: '2026-08-29T00:00:00Z' }

function productIn(categoryId: number | null): Product {
  return { id: Math.random(), category_id: categoryId } as Product
}

function renderManager(products: Product[] = []) {
  const onChanged = vi.fn().mockResolvedValue(undefined)
  render(<CategoryManager categories={[carnes, frutas]} products={products} onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button', { name: 'Administrar categorías (2)' }))
  return { onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CategoryManager — see #144', () => {
  it('starts collapsed, with the count on its toggle', () => {
    render(<CategoryManager categories={[carnes]} products={[]} onChanged={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Administrar categorías (1)' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Carnes')).not.toBeInTheDocument()
  })

  it('says how many products each category has', () => {
    renderManager([productIn(1), productIn(1), productIn(null)])

    expect(screen.getByText('2 productos')).toBeInTheDocument()
    expect(screen.getByText('Sin productos')).toBeInTheDocument()
  })

  describe('adding', () => {
    it('creates the trimmed name, clears the field and reports the change', async () => {
      mockedCreate.mockResolvedValue({ ...carnes, id: 3, name: 'Botanas' })
      const { onChanged } = renderManager()

      fireEvent.change(screen.getByLabelText('Nueva categoría'), { target: { value: '  Botanas ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

      await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith('Botanas'))
      await waitFor(() => expect(onChanged).toHaveBeenCalledWith())
      expect(screen.getByLabelText('Nueva categoría')).toHaveValue('')
    })

    it('does not offer to add a blank name', () => {
      renderManager()

      fireEvent.change(screen.getByLabelText('Nueva categoría'), { target: { value: '   ' } })

      expect(screen.getByRole('button', { name: 'Agregar' })).toBeDisabled()
    })

    it('keeps what was typed and shows why when it fails', async () => {
      mockedCreate.mockRejectedValue(new Error('boom'))
      renderManager()

      fireEvent.change(screen.getByLabelText('Nueva categoría'), { target: { value: 'Carnes' } })
      fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
      expect(screen.getByLabelText('Nueva categoría')).toHaveValue('Carnes')
    })
  })

  describe('renaming', () => {
    function startRename(value: string) {
      fireEvent.click(screen.getByRole('button', { name: 'Renombrar Carnes' }))
      fireEvent.change(screen.getByLabelText('Nuevo nombre de Carnes'), { target: { value } })
    }

    it('saves the new name and closes the field', async () => {
      mockedRename.mockResolvedValue({ ...carnes, name: 'Carnes frías' })
      const { onChanged } = renderManager()

      startRename('Carnes frías')
      fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre de Carnes' }))

      await waitFor(() => expect(mockedRename).toHaveBeenCalledWith(1, 'Carnes frías'))
      await waitFor(() => expect(onChanged).toHaveBeenCalledWith())
      expect(screen.queryByLabelText('Nuevo nombre de Carnes')).not.toBeInTheDocument()
    })

    it('sends nothing when the name did not change', () => {
      renderManager()

      startRename('Carnes')
      fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre de Carnes' }))

      expect(mockedRename).not.toHaveBeenCalled()
      expect(screen.queryByLabelText('Nuevo nombre de Carnes')).not.toBeInTheDocument()
    })

    it('backs out on Escape without letting it reach the dialog', () => {
      renderManager()
      const dialogEscape = vi.fn()
      document.addEventListener('keydown', dialogEscape)

      startRename('Otra')
      fireEvent.keyDown(screen.getByLabelText('Nuevo nombre de Carnes'), { key: 'Escape' })

      document.removeEventListener('keydown', dialogEscape)
      expect(screen.queryByLabelText('Nuevo nombre de Carnes')).not.toBeInTheDocument()
      expect(dialogEscape).not.toHaveBeenCalled()
      expect(mockedRename).not.toHaveBeenCalled()
    })

    it('shows a failure on its own row and keeps the field open', async () => {
      mockedRename.mockRejectedValue(new Error('boom'))
      renderManager()

      startRename('Frutas')
      fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre de Carnes' }))

      const alert = await screen.findByRole('alert')
      expect(alert.closest('li')).toContainElement(screen.getByLabelText('Nuevo nombre de Carnes'))
    })
  })

  describe('deleting', () => {
    it('asks first, saying what happens to its products', () => {
      renderManager([productIn(1), productIn(1)])

      fireEvent.click(screen.getByRole('button', { name: 'Eliminar Carnes' }))

      expect(screen.getByText(/2 productos quedarán sin categoría/)).toBeInTheDocument()
      expect(mockedDelete).not.toHaveBeenCalled()
    })

    it('deletes once confirmed and reports which one', async () => {
      mockedDelete.mockResolvedValue(undefined)
      const { onChanged } = renderManager()

      fireEvent.click(screen.getByRole('button', { name: 'Eliminar Carnes' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }))

      await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(1))
      await waitFor(() => expect(onChanged).toHaveBeenCalledWith(1))
    })

    it('backs out without deleting', () => {
      renderManager()

      fireEvent.click(screen.getByRole('button', { name: 'Eliminar Carnes' }))
      fireEvent.click(screen.getByRole('button', { name: 'Volver' }))

      expect(mockedDelete).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Renombrar Carnes' })).toBeInTheDocument()
    })
  })
})
