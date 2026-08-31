import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IconPicker } from '@/components/IconPicker'
import { ICON_CHOICES } from '@/iconChoices'

function renderPicker(overrides: Partial<Parameters<typeof IconPicker>[0]> = {}) {
  const onSelect = vi.fn()
  const onCancel = vi.fn()
  render(
    <IconPicker
      value="\u{1F34C}"
      onSelect={onSelect}
      onCancel={onCancel}
      busy={false}
      label="Cambiar icono de Plátano"
      {...overrides}
    />,
  )
  return { onSelect, onCancel }
}

describe('IconPicker', () => {
  it('renders every curated choice as its own button', () => {
    renderPicker()

    for (const icon of ICON_CHOICES) {
      expect(screen.getByRole('button', { name: icon })).toBeInTheDocument()
    }
  })

  it('marks the current value as pressed, and nothing else', () => {
    renderPicker({ value: '\u{1F34E}' })

    expect(screen.getByRole('button', { name: '\u{1F34E}' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '\u{1F34C}' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('selecting a different grid option calls onSelect with it', () => {
    const { onSelect } = renderPicker({ value: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: '\u{1F34E}' }))

    expect(onSelect).toHaveBeenCalledWith('\u{1F34E}')
  })

  it('tapping the already-selected option cancels rather than re-sending the same value', () => {
    const { onSelect, onCancel } = renderPicker({ value: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: '\u{1F34C}' }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('starts with "Otro" collapsed, showing a toggle rather than a text field', () => {
    renderPicker()

    expect(screen.getByRole('button', { name: 'Otro…' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Cambiar icono de Plátano')).not.toBeInTheDocument()
  })

  it('"Otro" reveals a text field prefilled with the current value', () => {
    renderPicker({ value: '\u{1F34C}' })

    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))

    expect(screen.getByLabelText('Cambiar icono de Plátano')).toHaveValue('\u{1F34C}')
  })

  it('Enter in "Otro" commits a changed, non-empty value', () => {
    const { onSelect } = renderPicker({ value: '\u{1F34C}' })
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')

    fireEvent.change(input, { target: { value: '\u{1F9C1}' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('\u{1F9C1}')
  })

  it('blur in "Otro" commits the same as Enter', () => {
    const { onSelect } = renderPicker({ value: '\u{1F34C}' })
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')

    fireEvent.change(input, { target: { value: '\u{1F9C1}' } })
    fireEvent.blur(input)

    expect(onSelect).toHaveBeenCalledWith('\u{1F9C1}')
  })

  it('Escape in "Otro" cancels without saving, even with a changed value', () => {
    const { onSelect, onCancel } = renderPicker({ value: '\u{1F34C}' })
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')

    fireEvent.change(input, { target: { value: '\u{1F9C1}' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('leaving "Otro" unchanged on blur cancels rather than re-sending the same value', () => {
    const { onSelect, onCancel } = renderPicker({ value: '\u{1F34C}' })
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))

    fireEvent.blur(screen.getByLabelText('Cambiar icono de Plátano'))

    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('a blank "Otro" field cancels rather than sending an empty icon', () => {
    const { onSelect, onCancel } = renderPicker({ value: '\u{1F34C}' })
    fireEvent.click(screen.getByRole('button', { name: 'Otro…' }))
    const input = screen.getByLabelText('Cambiar icono de Plátano')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('"Cerrar" cancels directly, without going through "Otro"', () => {
    const { onSelect, onCancel } = renderPicker()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar selector de icono' }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('disables every control while busy, so a second tap cannot fire mid-save', () => {
    renderPicker({ busy: true })

    expect(screen.getByRole('button', { name: '\u{1F34E}' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Otro…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cerrar selector de icono' })).toBeDisabled()
  })
})
