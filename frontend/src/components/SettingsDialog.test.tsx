import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsDialog } from '@/components/SettingsDialog'
import type { SettingsResponse } from '@/services/types'

vi.mock('@/services/settingsService', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  triggerAlert: vi.fn(),
}))

const service = await import('@/services/settingsService')
const mockedGet = vi.mocked(service.getSettings)
const mockedSave = vi.mocked(service.saveSettings)
const mockedTrigger = vi.mocked(service.triggerAlert)

function response(overrides: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    alerts: { enabled: true, alert_time: '08:00', days_ahead: 7, updated_at: '2026-08-30T00:00:00Z' },
    telegram_configured: true,
    next_run_at: '2026-08-31T08:00:00-06:00',
    // Pinned so the rendered time does not depend on the runner's zone.
    timezone: 'America/Mexico_City',
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('SettingsDialog', () => {
  it('loads the stored settings into the form', async () => {
    mockedGet.mockResolvedValue(response())

    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByLabelText('Hora')).toHaveValue('08:00')
    expect(screen.getByLabelText('Días de anticipación')).toHaveValue(7)
  })

  it('saves what the user changed', async () => {
    mockedGet.mockResolvedValue(response())
    mockedSave.mockResolvedValue(response())

    render(<SettingsDialog onClose={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Hora'), { target: { value: '19:45' } })
    fireEvent.change(screen.getByLabelText('Días de anticipación'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1))
    expect(mockedSave).toHaveBeenCalledWith({ enabled: true, alert_time: '19:45', days_ahead: 3 })
  })

  it('shows the rescheduled next run after saving', async () => {
    mockedGet.mockResolvedValue(response())
    mockedSave.mockResolvedValue(
      response({ alerts: { enabled: true, alert_time: '19:45', days_ahead: 7, updated_at: '' }, next_run_at: '2026-08-31T19:45:00-06:00' }),
    )

    render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByLabelText('Hora')
    expect(screen.getByText(/Próxima alerta:/)).toHaveTextContent(/8:00/)

    fireEvent.click(await screen.findByRole('button', { name: 'Guardar' }))

    // The minute is locale-independent; es-MX renders the hour as "7:45 p.m.".
    // Seeing it move proves the server rescheduled, not merely stored.
    await waitFor(() => expect(screen.getByText(/Próxima alerta:/)).toHaveTextContent(/:45/))
  })

  it('warns when Telegram is unconfigured and blocks the test send', async () => {
    mockedGet.mockResolvedValue(response({ telegram_configured: false, next_run_at: null }))

    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByText(/Telegram sin configurar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled()
  })

  it('says so when nothing is scheduled', async () => {
    mockedGet.mockResolvedValue(response({ next_run_at: null }))

    render(<SettingsDialog onClose={vi.fn()} />)

    expect(await screen.findByText('No hay ninguna alerta programada.')).toBeInTheDocument()
  })

  it('reports the result of a test send', async () => {
    mockedGet.mockResolvedValue(response())
    mockedTrigger.mockResolvedValue({ sent: true, products: 5, detail: 'Alerta enviada' })

    render(<SettingsDialog onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar prueba' }))

    expect(await screen.findByText('Alerta enviada')).toBeInTheDocument()
  })

  it('never renders anything that looks like a token', async () => {
    mockedGet.mockResolvedValue(response())

    const { container } = render(<SettingsDialog onClose={vi.fn()} />)
    await screen.findByLabelText('Hora')

    // The API does not send it; the UI must not invent a field for it either.
    expect(container.textContent).not.toMatch(/token/i)
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })
})
