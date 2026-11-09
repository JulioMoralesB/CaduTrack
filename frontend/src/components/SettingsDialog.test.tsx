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
    // Matches the fallback APP_VERSION resolves to under vitest, where
    // VITE_APP_VERSION is never set — see version.test.ts for that contract.
    backend_version: 'dev',
    ...overrides,
  }
}

function reassignment(overrides: Partial<IconReassignmentResult> = {}): IconReassignmentResult {
  return { considered: 3, updated: 2, still_default: 1, ...overrides }
}

function renderDialog(overrides: { onClose?: () => void; onIconsReassigned?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn()
  const onIconsReassigned = overrides.onIconsReassigned ?? vi.fn()
  render(
    <SettingsDialog
      categories={[]}
      products={[]}
      onClose={onClose}
      onIconsReassigned={onIconsReassigned}
      onCategoriesChanged={vi.fn()}
    />,
  )
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

  it('saves a change by itself, without a Guardar', async () => {
    mockedGet.mockResolvedValue(response())

    renderDialog()
    fireEvent.change(await screen.findByLabelText('Hora'), { target: { value: '19:45' } })

    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Guardando…')
    await waitFor(() =>
      expect(mockedSave).toHaveBeenCalledWith({ enabled: true, alert_time: '19:45', days_ahead: 7 }),
    )
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Guardado'))
    expect(mockedSaveIcons).not.toHaveBeenCalled()
  })

  it('sends one save for a burst of changes, with the last values', async () => {
    mockedGet.mockResolvedValue(response())

    renderDialog()
    const days = await screen.findByLabelText('Días de anticipación')
    fireEvent.change(days, { target: { value: '1' } })
    fireEvent.change(days, { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '19:45' } })

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1))
    expect(mockedSave).toHaveBeenCalledWith({ enabled: true, alert_time: '19:45', days_ahead: 14 })
  })

  it('saves the icon toggle through its own endpoint, leaving the alerts alone', async () => {
    mockedGet.mockResolvedValue(response())

    renderDialog()
    fireEvent.click(await screen.findByLabelText(/Asignar icono con IA/))

    await waitFor(() => expect(mockedSaveIcons).toHaveBeenCalledWith({ ai_enabled: false }))
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('shows the rescheduled next alert once saved', async () => {
    mockedGet.mockResolvedValue(response())
    mockedSave.mockResolvedValue(response({ next_run_at: null }))

    renderDialog()
    fireEvent.change(await screen.findByLabelText('Hora'), { target: { value: '19:45' } })

    expect(await screen.findByText('No hay ninguna alerta programada.')).toBeInTheDocument()
  })

  it.each([
    ['an empty number', 'Días de anticipación', '', 'Los días de anticipación van de 1 a 365.'],
    ['a number out of range', 'Días de anticipación', '400', 'Los días de anticipación van de 1 a 365.'],
    ['a cleared time', 'Hora', '', 'Elige una hora.'],
  ])('says why and sends nothing for %s', async (_case, label, value, message) => {
    mockedGet.mockResolvedValue(response())
    const { onClose } = renderDialog()

    fireEvent.change(await screen.findByLabelText(label), { target: { value } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('sends a change still waiting before closing', async () => {
    mockedGet.mockResolvedValue(response())
    const { onClose } = renderDialog()

    fireEvent.change(await screen.findByLabelText('Hora'), { target: { value: '19:45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mockedSave).toHaveBeenCalledTimes(1)
  })

  it('closes right away when nothing changed, without saving', async () => {
    mockedGet.mockResolvedValue(response())
    const { onClose } = renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Listo' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mockedSave).not.toHaveBeenCalled()
    expect(mockedSaveIcons).not.toHaveBeenCalled()
  })

  it('stays open with the reason when a save fails, and a second close leaves', async () => {
    mockedGet.mockResolvedValue(response())
    mockedSave.mockRejectedValue(new Error('boom'))
    const { onClose } = renderDialog()

    fireEvent.change(await screen.findByLabelText('Hora'), { target: { value: '19:45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó: Ocurrió un error inesperado.')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Cierra otra vez'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('stays open when the icon-toggle save fails', async () => {
    mockedGet.mockResolvedValue(response())
    mockedSaveIcons.mockRejectedValue(new Error('boom'))
    const { onClose } = renderDialog()

    fireEvent.click(await screen.findByLabelText(/Asignar icono con IA/))
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saves what is on screen before sending a test alert', async () => {
    mockedGet.mockResolvedValue(response())
    mockedTrigger.mockResolvedValue({ sent: true, products: 1, detail: 'Enviado' })
    renderDialog()

    fireEvent.change(await screen.findByLabelText('Días de anticipación'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar prueba' }))

    await waitFor(() => expect(mockedTrigger).toHaveBeenCalledTimes(1))
    expect(mockedSave.mock.invocationCallOrder[0]).toBeLessThan(mockedTrigger.mock.invocationCallOrder[0])
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

    const { container } = render(<SettingsDialog categories={[]} products={[]} onClose={vi.fn()} onIconsReassigned={vi.fn()} onCategoriesChanged={vi.fn()} />)
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

describe('SettingsDialog version footer', () => {
  it('shows a single version when frontend and backend agree', async () => {
    // APP_VERSION resolves to 'dev' under vitest — see version.test.ts.
    mockedGet.mockResolvedValue(response({ backend_version: 'dev' }))

    renderDialog()

    expect(await screen.findByText('CaduTrack dev')).toBeInTheDocument()
  })

  it('flags a mismatch instead of silently showing one of the two', async () => {
    mockedGet.mockResolvedValue(response({ backend_version: 'v0.11.0' }))

    renderDialog()

    const footer = await screen.findByText(/no coinciden/)
    expect(footer).toHaveTextContent('Frontend dev · API v0.11.0')
  })

  it('shows the frontend version alone before settings finish loading', () => {
    mockedGet.mockReturnValue(new Promise(() => {})) // never resolves

    renderDialog()

    expect(screen.getByText('CaduTrack dev')).toBeInTheDocument()
  })
})
