import { beforeEach, describe, expect, it, vi } from 'vitest'

import { lookupBarcode, rememberBarcode } from '@/services/barcodesService'

vi.mock('@/services/api', () => ({
  api: { post: vi.fn() },
}))

const { api } = await import('@/services/api')
const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lookupBarcode', () => {
  it('posts the scanned code and returns what the backend resolved', async () => {
    const result = { item_code: '5449000000996', name: 'Coca-Cola', icon: null, quantity: null, unit: null }
    mockedApi.post.mockResolvedValue({ data: result })

    expect(await lookupBarcode('5449000000996')).toEqual(result)
    const [path, body] = mockedApi.post.mock.calls[0]
    expect(path).toBe('/barcodes/lookup')
    expect(body).toEqual({ code: '5449000000996' })
  })

  it('is not retried — the user can just point the camera again', async () => {
    mockedApi.post.mockRejectedValue(new Error('boom'))

    await expect(lookupBarcode('123')).rejects.toThrow('boom')
    expect(mockedApi.post.mock.calls).toHaveLength(1)
  })
})

describe('rememberBarcode', () => {
  it('posts the name and icon to the code-specific endpoint', async () => {
    mockedApi.post.mockResolvedValue({ data: {} })

    await rememberBarcode('5449000000996', 'Coca-Cola', '\u{1F964}')

    const [path, body] = mockedApi.post.mock.calls[0]
    expect(path).toBe('/barcodes/5449000000996/remember')
    expect(body).toEqual({ name: 'Coca-Cola', icon: '\u{1F964}' })
  })

  it('escapes a code with characters that are not safe in a URL path', async () => {
    mockedApi.post.mockResolvedValue({ data: {} })

    await rememberBarcode('01/29045580000076', 'Nopal limpio', null)

    const [path] = mockedApi.post.mock.calls[0]
    expect(path).toBe('/barcodes/01%2F29045580000076/remember')
  })

  it('is not retried — a best-effort cache write behind an already-successful save', async () => {
    mockedApi.post.mockRejectedValue(new Error('boom'))

    await expect(rememberBarcode('123', 'Algo', null)).rejects.toThrow('boom')
    expect(mockedApi.post.mock.calls).toHaveLength(1)
  })
})
