import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsDialog } from '@/components/SettingsDialog'
import type { IconReassignmentResult, SettingsResponse } from '@/services/types'

vi.mock('@/services/settingsService', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  saveIconSettings: vi.fn(),
  triggerAlert: vi.fn(),
}))

vi.mock('@/services/productsService', () => ({
  reassignIcons: vi.fn(),
}))

const service = await import('@/services/settingsService')
const products = await import('@/services/productsService')
const mockedGet = vi.mocked(service.getSettings)
const mockedSave = vi.mocked(service.saveSettings)
const mockedSaveIcons = vi.mocked(service.saveIconSettings)
const mockedTrigger = vi.mocked(service.triggerAlert)
const mockedReassign = vi.mocked(products.reassignIcons)

function response(overrides: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    alerts: { enabled: true, alert_time: '08:00', days_ahead: 7, updated_at: '2026-08-30T00:00:00Z' },
    icons: { ai_enabled: true, updated_at: '2026-08-30T00:00:00Z' },
    telegram_configured: true,
    next_run_at: '2026-08-31T08:00:00-06:00',
    // Pinned so the rendered time does not depend on the runner's zone.
    timezone: 'America/Mexico_City',
    ollama_configured: true,
    ...overrides,
  }
}

function reassignment(overrides: Partial<IconReassignmentResult> = {}): IconReassignmentResult {
  return { considered: 3, updated: 2, still_default: 1, ...overrides }
}

function renderDialog(overrides: { onClose?: () => void; onIconsReassigned?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn()
  const onIconsReassigned = overrides.onIconsReassigned ?? vi.fn()
  render(<SettingsDialog onClose={onClose} onIconsReassigned={onIconsReassigned} />)
  return { onClose, onIconsReassigned }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedSave.mockResolvedValue(response())
  mockedSaveIcons.mockResolvedValue(response())
})

describe('SettingsDialog', () => {
  it('loads the stored settings into the form', async () => {
    mockedGet.mockResolvedValue(response())

    renderDialog()

    expect(await screen.findByLabelText('Hora')).toHaveValue('08:00')
    expect(screen.getByLabelText('Días de anticipación')).toHaveValue(7)
    expect(screen.getByLabelText(/Asignar icono con IA/)).toBeChecked()
  })

  it('saves what the user changed', async () => {
    mockedGet.mockResolvedValue(response())

    renderDialog()
    fireEvent.change(await screen.findByLabelText('Hora'), { target: { value: '19:45' } })
    fireEvent.change(screen.getByLabelText('Días de anticipación'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1))
    expect(mockedSave).toHaveBeenCalledWith({ enabled: true, alert_time: '19:45', days_ahead: 3 })
  })

  it('saves the icon toggle through its own endpoint, alongside the alert save', async () => {
    mockedGet.mockResolvedValue(response({ icons: { ai_enabled: true, updated_at: '2026-08-30T00:00:00Z' } }))

    renderDialog()
    fireEvent.click(await screen.findByLabelText(/Asignar icono con IA/))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedSaveIcons).toHaveBeenCalledWith({ ai_enabled: false }))
    // Both requests fire, not one instead of the other.
    expect(mockedSave).toHaveBeenCalledTimes(1)
  })

  it('closes once the save succeeds', async () => {
    // Leaving it open reads as "nothing happened", which is what every other
    // app taught the user to expect otherwise.
    mockedGet.mockResolvedValue(response())
    const { onClose } = renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('stays open with the reason when the alert save fails', async () => {
    mockedGet.mockResolvedValue(response())
    mockedSave.mockRejectedValue(new Error('boom'))
    const { onClose } = renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open with the reason when the icon-toggle save fails', async () => {
    mockedGet.mockResolvedValue(response())
    mockedSaveIcons.mockRejectedValue(new Error('boom'))
    const { onClose } = renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('warns when Telegram is unconfigured and blocks the test send', async () => {
    mockedGet.mockResolvedValue(response({ telegram_configured: false, next_run_at: null }))

    renderDialog()

    expect(await screen.findByText(/Telegram sin configurar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled()
  })

  it('warns when Ollama is unconfigured, without disabling the toggle itself', async () => {
    mockedGet.mockResolvedValue(response({ ollama_configured: false }))

    renderDialog()

    expect(await screen.findByText(/Modelo de iconos sin configurar/)).toBeInTheDocument()
    // Unlike the Telegram test button, nothing here needs to be disabled: an
    // unreachable model already degrades to the default icon on its own.
    expect(screen.getByLabelText(/Asignar icono con IA/)).toBeEnabled()
  })

  it('says so when nothing is scheduled', async () => {
    mockedGet.mockResolvedValue(response({ next_run_at: null }))

    renderDialog()

    expect(await screen.findByText('No hay ninguna alerta programada.')).toBeInTheDocument()
  })

  it('reports the result of a test send', async () => {
    mockedGet.mockResolvedValue(response())
    mockedTrigger.mockResolvedValue({ sent: true, products: 5, detail: 'Alerta enviada' })

    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar prueba' }))

    expect(await screen.findByText('Alerta enviada')).toBeInTheDocument()
  })

  it('never renders anything that looks like a token', async () => {
    mockedGet.mockResolvedValue(response())

    const { container } = render(<SettingsDialog onClose={vi.fn()} onIconsReassigned={vi.fn()} />)
    await screen.findByLabelText('Hora')

    // The API does not send it; the UI must not invent a field for it either.
    expect(container.textContent).not.toMatch(/token/i)
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })
})

describe('SettingsDialog icon reassignment', () => {
  it('reports how many products were updated', async () => {
    mockedGet.mockResolvedValue(response())
    mockedReassign.mockResolvedValue(reassignment({ considered: 5, updated: 3, still_default: 2 }))

    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Reasignar iconos' }))

    expect(await screen.findByText('3 de 5 productos actualizados.')).toBeInTheDocument()
  })

  it('says so when nothing needed reassigning', async () => {
    mockedGet.mockResolvedValue(response())
    mockedReassign.mockResolvedValue(reassignment({ considered: 0, updated: 0, still_default: 0 }))

    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Reasignar iconos' }))

    expect(await screen.findByText('No hay productos pendientes de icono.')).toBeInTheDocument()
  })

  it('tells the product list to reload when something actually changed', async () => {
    mockedGet.mockResolvedValue(response())
    mockedReassign.mockResolvedValue(reassignment({ considered: 3, updated: 2, still_default: 1 }))
    const { onIconsReassigned } = renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Reasignar iconos' }))

    await waitFor(() => expect(onIconsReassigned).toHaveBeenCalledOnce())
  })

  it('does not reload the list when nothing changed', async () => {
    mockedGet.mockResolvedValue(response())
    mockedReassign.mockResolvedValue(reassignment({ considered: 3, updated: 0, still_default: 3 }))
    const { onIconsReassigned } = renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Reasignar iconos' }))

    await screen.findByText('0 de 3 productos actualizados.')
    expect(onIconsReassigned).not.toHaveBeenCalled()
  })

  it('shows the failure inline and does not close the dialog', async () => {
    mockedGet.mockResolvedValue(response())
    mockedReassign.mockRejectedValue(new Error('boom'))
    const { onClose } = renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Reasignar iconos' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error inesperado.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables the button while the request is in flight', async () => {
    let resolveRequest: (result: IconReassignmentResult) => void = () => {}
    mockedGet.mockResolvedValue(response())
    mockedReassign.mockReturnValue(
      new Promise<IconReassignmentResult>((resolve) => {
        resolveRequest = resolve
      }),
    )
    renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Reasignar iconos' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /reasignando/i })).toBeDisabled())

    resolveRequest(reassignment())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reasignar iconos' })).toBeEnabled())
  })
})
