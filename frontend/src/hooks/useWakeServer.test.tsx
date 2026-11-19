import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WakeServerButton } from '@/components/WakeServerButton'
import { WAKE_GIVE_UP_MS, WAKE_POLL_MS, useWakeServer } from '@/hooks/useWakeServer'

vi.mock('@/services/wakeService', () => ({
  wakeAvailable: vi.fn(),
  requestWake: vi.fn(),
  serverIsUp: vi.fn(),
}))

const wake = await import('@/services/wakeService')
const mockedAvailable = vi.mocked(wake.wakeAvailable)
const mockedRequest = vi.mocked(wake.requestWake)
const mockedUp = vi.mocked(wake.serverIsUp)

function Harness({ active, onAwake }: { active: boolean; onAwake: () => void }) {
  return <WakeServerButton {...useWakeServer(active, onAwake)} />
}

/** Let the pending promises and any timers due by then run. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockedAvailable.mockResolvedValue(true)
  mockedRequest.mockResolvedValue()
  mockedUp.mockResolvedValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderAndProbe(active = true) {
  const onAwake = vi.fn()
  const view = render(<Harness active={active} onAwake={onAwake} />)
  await advance(0)
  return { onAwake, ...view }
}

describe('Encender servidor', () => {
  it('is offered while the server is unreachable and the Worker is there', async () => {
    await renderAndProbe()

    expect(screen.getByRole('button', { name: 'Encender servidor' })).toBeInTheDocument()
  })

  it('is not offered by a deployment without the Worker', async () => {
    mockedAvailable.mockResolvedValue(false)
    await renderAndProbe()

    expect(screen.queryByRole('button', { name: 'Encender servidor' })).not.toBeInTheDocument()
  })

  it('is not offered, nor even asked about, while the server is reachable', async () => {
    await renderAndProbe(false)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mockedAvailable).not.toHaveBeenCalled()
  })

  it('asks once, then checks every few seconds until the server answers, and reloads', async () => {
    const { onAwake } = await renderAndProbe()

    fireEvent.click(screen.getByRole('button', { name: 'Encender servidor' }))
    await advance(0)

    expect(mockedRequest).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Encendiendo el servidor…')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    await advance(WAKE_POLL_MS * 3)
    expect(mockedUp).toHaveBeenCalledTimes(3)
    expect(onAwake).not.toHaveBeenCalled()

    mockedUp.mockResolvedValue(true)
    await advance(WAKE_POLL_MS)

    expect(onAwake).toHaveBeenCalledOnce()
    expect(mockedRequest).toHaveBeenCalledOnce()
    // Stops checking once it is up.
    const checks = mockedUp.mock.calls.length
    await advance(WAKE_POLL_MS * 5)
    expect(mockedUp).toHaveBeenCalledTimes(checks)
  })

  it('gives up after four minutes and offers to try again', async () => {
    const { onAwake } = await renderAndProbe()

    fireEvent.click(screen.getByRole('button', { name: 'Encender servidor' }))
    await advance(WAKE_GIVE_UP_MS + WAKE_POLL_MS)

    expect(screen.getByRole('alert')).toHaveTextContent('El servidor no respondió después de 4 minutos.')
    expect(onAwake).not.toHaveBeenCalled()
    const checks = mockedUp.mock.calls.length
    expect(checks).toBeGreaterThanOrEqual(WAKE_GIVE_UP_MS / WAKE_POLL_MS - 1)

    // Nothing keeps running behind the message.
    await advance(WAKE_POLL_MS * 5)
    expect(mockedUp).toHaveBeenCalledTimes(checks)

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar encender' }))
    await advance(0)
    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent('Encendiendo el servidor…')
  })

  it('says so when the request to turn it on does not go through', async () => {
    mockedRequest.mockRejectedValue(new Error('403'))
    await renderAndProbe()

    fireEvent.click(screen.getByRole('button', { name: 'Encender servidor' }))
    await advance(0)

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo pedir que se encienda el servidor.')
    expect(mockedUp).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reintentar encender' })).toBeInTheDocument()
  })

  it('keeps waiting while the list behind it reloads', async () => {
    const onAwake = vi.fn()
    const { rerender } = render(<Harness active onAwake={onAwake} />)
    await advance(0)
    fireEvent.click(screen.getByRole('button', { name: 'Encender servidor' }))
    await advance(0)

    // A retry of the list itself: no longer "unreachable" for a moment.
    rerender(<Harness active={false} onAwake={onAwake} />)
    expect(screen.getByRole('status')).toHaveTextContent('Encendiendo el servidor…')

    mockedUp.mockResolvedValue(true)
    await advance(WAKE_POLL_MS)
    expect(onAwake).toHaveBeenCalledOnce()
  })
})
