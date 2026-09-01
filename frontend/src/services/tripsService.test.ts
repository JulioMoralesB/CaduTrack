import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dropTripItem,
  getCurrentTrip,
  resolveTripItem,
  updateTripItem,
  uploadReceipt,
} from '@/services/tripsService'

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { api } = await import('@/services/api')
const mockedApi = vi.mocked(api)

function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('uploadReceipt', () => {
  it('posts the image as multipart form data with the JSON content type overridden', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 1, items: [] } })
    const image = new File(['fake'], 'receipt.jpg', { type: 'image/jpeg' })

    const result = await uploadReceipt(image)

    expect(result).toEqual({ id: 1, items: [] })
    const [path, body, config] = mockedApi.post.mock.calls[0]
    expect(path).toBe('/trips/receipt')
    expect(body).toBeInstanceOf(FormData)
    expect(config?.headers?.['Content-Type']).not.toMatch(/json/i)
  })

  it('is not retried — it already creates records, not just reads them', async () => {
    mockedApi.post.mockRejectedValue(networkError())

    await expect(uploadReceipt(new File(['x'], 'r.jpg'))).rejects.toThrow('Network Error')
    expect(mockedApi.post.mock.calls).toHaveLength(1)
  })
})

describe('getCurrentTrip', () => {
  it('returns the trip the API reports', async () => {
    mockedApi.get.mockResolvedValue({ data: { id: 7, items: [] } })

    expect(await getCurrentTrip()).toEqual({ id: 7, items: [] })
  })

  it('passes through null when there is nothing to resume', async () => {
    mockedApi.get.mockResolvedValue({ data: null })

    expect(await getCurrentTrip()).toBeNull()
  })
})

describe('updateTripItem', () => {
  it('sends the corrected fields and retries a dropped connection', async () => {
    mockedApi.patch
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue({ data: { id: 2, name: 'Nopal' } })

    const result = await updateTripItem(1, 2, { name: 'Nopal', quantity: '1.00', is_food: true })

    expect(result).toEqual({ id: 2, name: 'Nopal' })
    expect(mockedApi.patch.mock.calls).toHaveLength(2)
    expect(mockedApi.patch.mock.calls[0]).toEqual([
      '/trips/1/items/2',
      { name: 'Nopal', quantity: '1.00', is_food: true },
    ])
  })
})

describe('dropTripItem', () => {
  it('posts to the drop endpoint and does not retry a failure', async () => {
    mockedApi.post.mockRejectedValue(networkError())

    await expect(dropTripItem(1, 2)).rejects.toThrow('Network Error')
    expect(mockedApi.post.mock.calls).toEqual([['/trips/1/items/2/drop']])
  })
})

describe('resolveTripItem', () => {
  it('posts the product id to the resolve endpoint and does not retry a failure', async () => {
    mockedApi.post.mockRejectedValue(networkError())

    await expect(resolveTripItem(1, 2, 99)).rejects.toThrow('Network Error')
    expect(mockedApi.post.mock.calls).toEqual([['/trips/1/items/2/resolve', { product_id: 99 }]])
  })
})
