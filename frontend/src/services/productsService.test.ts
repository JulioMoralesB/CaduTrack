import { AxiosError } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { createProduct, deleteProduct, replaceProduct } from '@/services/productsService'
import type { ProductPayload } from '@/services/types'

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const { api } = await import('@/services/api')
const mockedApi = vi.mocked(api)

const payload = {} as ProductPayload

function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK)
}

/**
 * These exercise the wiring, not the retry logic — `retry.test.ts` owns that.
 * Without them, deleting `withRetry` from a call site would break nothing.
 */
describe('products service retries', () => {
  it('retries a create through a dropped connection', async () => {
    mockedApi.post
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue({ data: { id: 7 } })

    await expect(createProduct(payload)).resolves.toEqual({ id: 7 })
    expect(mockedApi.post.mock.calls).toHaveLength(2)
  })

  it('retries a replace through a dropped connection', async () => {
    mockedApi.put.mockRejectedValueOnce(networkError()).mockResolvedValue({ data: { id: 7 } })

    await expect(replaceProduct(7, payload)).resolves.toEqual({ id: 7 })
    expect(mockedApi.put.mock.calls).toHaveLength(2)
  })

  it('never repeats a delete, which would report a 404 for work that succeeded', async () => {
    mockedApi.delete.mockRejectedValue(networkError())

    await expect(deleteProduct(7)).rejects.toThrow('Network Error')
    expect(mockedApi.delete.mock.calls).toHaveLength(1)
  })
})
