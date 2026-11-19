import { useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Modal } from '@/components/Modal'
import { useHoldReload } from '@/hooks/useHoldReload'
import { MODAL_SETTLE_MS, modalDepthInHistory } from '@/modalHistory'
import { holdReload, reloadWhenSafe } from '@/updateGate'

/** Long enough for a history traversal and the tidy-up after it to land. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, MODAL_SETTLE_MS * 4)))
}

afterEach(async () => {
  cleanup()
  await settle()
  expect(modalDepthInHistory()).toBe(0)
})

describe('reloadWhenSafe — see #175', () => {
  it('reloads straight away when nothing is open or in flight', async () => {
    const reload = vi.fn()

    reloadWhenSafe(reload)
    await settle()

    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits for an open dialog to close', async () => {
    const reload = vi.fn()
    const { unmount } = render(<Modal title="Agregar producto" onClose={() => {}}>formulario</Modal>)

    reloadWhenSafe(reload)
    await settle()
    expect(reload).not.toHaveBeenCalled()

    unmount()
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads only once its history entry is gone, so back is not left with a stale step', async () => {
    let depthWhenReloaded = -1
    const reload = vi.fn(() => {
      depthWhenReloaded = modalDepthInHistory()
    })
    const { unmount } = render(<Modal title="Historial" onClose={() => {}}>lista</Modal>)

    reloadWhenSafe(reload)
    unmount()
    await settle()

    expect(reload).toHaveBeenCalledOnce()
    expect(depthWhenReloaded).toBe(0)
  })

  it('does not slip in while one dialog hands over to the next — a receipt walk', async () => {
    const reload = vi.fn()
    function Walk() {
      const [step, setStep] = useState(1)
      if (step > 2) return null
      return (
        <Modal key={step} title={`Producto ${step}`} onClose={() => {}}>
          <button type="button" onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        </Modal>
      )
    }
    render(<Walk />)

    reloadWhenSafe(reload)
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await settle()
    expect(reload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits for work in flight to finish', async () => {
    const reload = vi.fn()
    const release = holdReload()

    reloadWhenSafe(reload)
    await settle()
    expect(reload).not.toHaveBeenCalled()

    release()
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('counts a release twice as once', async () => {
    const reload = vi.fn()
    const first = holdReload()
    const second = holdReload()

    reloadWhenSafe(reload)
    first()
    first()
    await settle()
    expect(reload).not.toHaveBeenCalled()

    second()
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not slip in when work ends by opening a dialog — a receipt read', async () => {
    const reload = vi.fn()
    function Receipt() {
      const [reading, setReading] = useState(true)
      // The hold ends in the same render the dialog mounts in, as in
      // ProductList when a receipt read comes back.
      return (
        <HeldWhile active={reading}>
          <button type="button" onClick={() => setReading(false)}>
            Leído
          </button>
          {!reading && <Modal title="Compra" onClose={() => {}}>artículos</Modal>}
        </HeldWhile>
      )
    }
    render(<Receipt />)

    reloadWhenSafe(reload)
    fireEvent.click(screen.getByRole('button', { name: 'Leído' }))
    await settle()

    expect(screen.getByRole('dialog', { name: 'Compra' })).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads only once, however many times it is asked', async () => {
    const reload = vi.fn()
    const release = holdReload()

    reloadWhenSafe(reload)
    reloadWhenSafe(reload)
    release()
    await settle()

    expect(reload).toHaveBeenCalledOnce()
  })
})

/** Holds the reload while `active`, the way ProductList does around uploads. */
function HeldWhile({ active, children }: { active: boolean; children: ReactNode }) {
  useHoldReload(active)
  return <>{children}</>
}
