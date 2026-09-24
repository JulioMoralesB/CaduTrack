import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AddMenu } from '@/components/AddMenu'

function renderMenu(overrides: Partial<Parameters<typeof AddMenu>[0]> = {}) {
  const props = {
    onManual: vi.fn(),
    onLabels: vi.fn(),
    onReceipt: vi.fn(),
    labelsBusy: false,
    receiptBusy: false,
    ...overrides,
  }
  render(<AddMenu {...props} />)
  return props
}

const toggle = () => screen.getByRole('button', { name: 'Agregar' })

describe('AddMenu — see #147', () => {
  it('starts closed and opens its three options', () => {
    renderMenu()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Un producto/ })).not.toBeInTheDocument()

    fireEvent.click(toggle())

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Un producto/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Varias etiquetas/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Recibo/ })).toBeInTheDocument()
  })

  it.each([
    [/^Un producto/, 'onManual'],
    [/^Varias etiquetas/, 'onLabels'],
    [/^Recibo/, 'onReceipt'],
  ] as const)('%s runs its action and closes the menu', (name, handler) => {
    const props = renderMenu()
    fireEvent.click(toggle())

    fireEvent.click(screen.getByRole('button', { name }))

    expect(props[handler]).toHaveBeenCalledTimes(1)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape and on a tap outside', () => {
    renderMenu()
    fireEvent.click(toggle())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle())
    fireEvent.pointerDown(document.body)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('stays open for a tap inside it', () => {
    renderMenu()
    fireEvent.click(toggle())

    fireEvent.pointerDown(screen.getByRole('button', { name: /^Recibo/ }))

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('disables an option while its own upload is running', () => {
    renderMenu({ receiptBusy: true })
    fireEvent.click(toggle())

    expect(screen.getByRole('button', { name: /^Recibo/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Varias etiquetas/ })).toBeEnabled()
  })
})
