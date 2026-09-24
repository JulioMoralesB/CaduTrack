import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UNDO_TOAST_MS, UndoToast } from '@/components/UndoToast'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UndoToast — see #143', () => {
  it('announces the message politely', () => {
    render(<UndoToast message="Consumido: Leche" onUndo={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Consumido: Leche')
  })

  it('goes away on its own after a few seconds', () => {
    const onDismiss = vi.fn()
    render(<UndoToast message="Consumido: Leche" onUndo={vi.fn()} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(UNDO_TOAST_MS - 1)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('runs the undo, then dismisses itself', async () => {
    const onUndo = vi.fn().mockResolvedValue(undefined)
    const onDismiss = vi.fn()
    render(<UndoToast message="Consumido: Leche" onUndo={onUndo} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }))

    expect(onUndo).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1))
  })

  it('keeps a failed undo on screen, with a retry, instead of timing out', async () => {
    const onUndo = vi.fn().mockRejectedValue(new Error('boom'))
    const onDismiss = vi.fn()
    render(<UndoToast message="Consumido: Leche" onUndo={onUndo} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }))

    expect(await screen.findByText('Ocurrió un error inesperado.')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(UNDO_TOAST_MS * 2)
    })
    expect(onDismiss).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
