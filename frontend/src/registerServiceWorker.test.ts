import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerServiceWorker } from '@/registerServiceWorker'

vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn(),
}))

const { registerSW } = await import('virtual:pwa-register')
const mockedRegisterSW = vi.mocked(registerSW)

function fakeRegistration(): { registration: ServiceWorkerRegistration; update: ReturnType<typeof vi.fn> } {
  const update = vi.fn()
  return { registration: { update } as unknown as ServiceWorkerRegistration, update }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerServiceWorker', () => {
  it('registers immediately, not waiting for the first interaction', () => {
    mockedRegisterSW.mockImplementation(() => vi.fn())

    registerServiceWorker()

    expect(mockedRegisterSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }))
  })

  it('checks for an update when the tab becomes visible again', () => {
    const { registration, update } = fakeRegistration()
    mockedRegisterSW.mockImplementation((options) => {
      options?.onRegisteredSW?.('/sw.js', registration)
      return vi.fn()
    })

    registerServiceWorker()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(update).toHaveBeenCalled()
  })

  it('does not check on visibilitychange while the tab is hidden', () => {
    const { registration, update } = fakeRegistration()
    mockedRegisterSW.mockImplementation((options) => {
      options?.onRegisteredSW?.('/sw.js', registration)
      return vi.fn()
    })

    registerServiceWorker()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(update).not.toHaveBeenCalled()
  })

  it('checks for an update when connectivity returns', () => {
    const { registration, update } = fakeRegistration()
    mockedRegisterSW.mockImplementation((options) => {
      options?.onRegisteredSW?.('/sw.js', registration)
      return vi.fn()
    })

    registerServiceWorker()
    window.dispatchEvent(new Event('online'))

    expect(update).toHaveBeenCalled()
  })

  it('does not throw when registration failed', () => {
    mockedRegisterSW.mockImplementation((options) => {
      options?.onRegisteredSW?.('/sw.js', undefined)
      return vi.fn()
    })

    expect(() => registerServiceWorker()).not.toThrow()
  })
})
