import { beforeEach, describe, expect, it, vi } from 'vitest'

import { extractLabel } from '@/services/visionService'

vi.mock('@/services/api', () => ({
  api: { post: vi.fn() },
}))

const { api } = await import('@/services/api')
const mockedApi = vi.mocked(api)

const image = new File(['fake'], 'label.png', { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('visionService', () => {
  it('posts the image as multipart form data', async () => {
    mockedApi.post.mockResolvedValue({
      data: { name: 'Nopal limpio', expires_at: '2026-09-01', quantity: '0.59', unit: 'kg' },
    })

    const result = await extractLabel(image)

    expect(result).toEqual({ name: 'Nopal limpio', expires_at: '2026-09-01', quantity: '0.59', unit: 'kg' })
    const [path, body] = mockedApi.post.mock.calls[0]
    expect(path).toBe('/vision/label')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('image')).toBe(image)
  })

  it('overrides the default JSON content type, or axios silently stringifies the file away', async () => {
    /**
     * Reproduced directly against the real backend before this existed: the
     * shared `api` instance defaults to "application/json", and axios's
     * FormData handling only sends a real multipart body when the request's
     * Content-Type does not already look like JSON. Without this override
     * the backend received a 422 "field required" for `image` — the file
     * never left as multipart at all, just a JSON-stringified husk of the
     * FormData object. See visionService.ts's own comment.
     */
    mockedApi.post.mockResolvedValue({ data: { name: null, expires_at: null, quantity: null, unit: null } })

    await extractLabel(image)

    const [, , config] = mockedApi.post.mock.calls[0]
    expect(config?.headers?.['Content-Type']).not.toMatch(/json/i)
  })

  it('is not retried — a repeat costs real time and data on a read-only call', async () => {
    mockedApi.post.mockRejectedValue(new Error('boom'))

    await expect(extractLabel(image)).rejects.toThrow('boom')
    expect(mockedApi.post.mock.calls).toHaveLength(1)
  })
})
