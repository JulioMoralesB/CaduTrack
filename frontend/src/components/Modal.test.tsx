import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Modal } from '@/components/Modal'
import { MODAL_SETTLE_MS, modalDepthInHistory } from '@/modalHistory'

/** Long enough for a history traversal and the tidy-up after it to land. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, MODAL_SETTLE_MS * 3)))
}

/** The system back button, as far as the page can tell. */
async function pressBack() {
  window.history.back()
  await settle()
}

function backdrop(): HTMLElement {
  return screen.getByRole('dialog').parentElement as HTMLElement
}

// Every test leaves the history as it found it, so the next one starts from
// a page with no dialog entries on it. Unmounted here rather than left to
// the library's own cleanup, which runs after this hook.
afterEach(async () => {
  cleanup()
  await settle()
  expect(modalDepthInHistory()).toBe(0)
})

describe('Modal backdrop — see #174', () => {
  it('closes on a tap outside the panel', () => {
    const onClose = vi.fn()
    render(<Modal title="Historial" onClose={onClose}>contenido</Modal>)

    fireEvent.click(backdrop())

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores a tap outside the panel when told there is something to lose', () => {
    const onClose = vi.fn()
    render(
      <Modal title="Agregar producto" onClose={onClose} dismissOnBackdrop={false}>
        contenido
      </Modal>,
    )

    fireEvent.click(backdrop())
    expect(onClose).not.toHaveBeenCalled()

    // The deliberate ways out still work.
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('never closes on a tap inside the panel', () => {
    const onClose = vi.fn()
    render(<Modal title="Historial" onClose={onClose}>contenido</Modal>)

    fireEvent.click(screen.getByText('contenido'))

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Modal and the back button — see #174', () => {
  it('closes on back instead of letting it leave the app', async () => {
    const onClose = vi.fn()
    const { unmount } = render(<Modal title="Historial" onClose={onClose}>contenido</Modal>)
    expect(modalDepthInHistory()).toBe(1)

    await pressBack()

    expect(onClose).toHaveBeenCalledOnce()
    unmount()
  })

  it('takes its history entry with it when closed any other way', async () => {
    const onClose = vi.fn()
    const { unmount } = render(<Modal title="Historial" onClose={onClose}>contenido</Modal>)

    unmount()
    await settle()

    expect(modalDepthInHistory()).toBe(0)
    // Its own tidy-up is not a back press.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls the latest onClose, not the one it was opened with', async () => {
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender, unmount } = render(<Modal title="Historial" onClose={first}>contenido</Modal>)
    rerender(<Modal title="Historial" onClose={latest}>contenido</Modal>)

    await pressBack()

    expect(latest).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    unmount()
  })

  it('hands its entry to a dialog that replaces it, so one back still closes that one', async () => {
    // A receipt or label walk: each product's form closes and the next opens
    // in the same render.
    const closeFirst = vi.fn()
    const closeSecond = vi.fn()
    const { rerender, unmount } = render(<Modal key="a" title="Uno" onClose={closeFirst}>uno</Modal>)

    rerender(<Modal key="b" title="Dos" onClose={closeSecond}>dos</Modal>)
    await settle()

    expect(modalDepthInHistory()).toBe(1)
    expect(closeFirst).not.toHaveBeenCalled()
    expect(closeSecond).not.toHaveBeenCalled()

    await pressBack()

    expect(closeSecond).toHaveBeenCalledOnce()
    unmount()
  })

  it('keeps asking a dialog that stays open — Ajustes with a save still failing', async () => {
    const onClose = vi.fn()
    const { unmount } = render(<Modal title="Ajustes" onClose={onClose}>contenido</Modal>)

    await pressBack()
    expect(onClose).toHaveBeenCalledTimes(1)
    // Still open, so it gets its entry back: the next back asks again
    // rather than leaving the app from under it.
    expect(modalDepthInHistory()).toBe(1)

    await pressBack()
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('survives being mounted twice by StrictMode', async () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <StrictMode>
        <Modal title="Historial" onClose={onClose}>contenido</Modal>
      </StrictMode>,
    )
    await settle()

    expect(onClose).not.toHaveBeenCalled()
    expect(modalDepthInHistory()).toBe(1)

    await pressBack()

    expect(onClose).toHaveBeenCalledOnce()
    unmount()
  })
})
