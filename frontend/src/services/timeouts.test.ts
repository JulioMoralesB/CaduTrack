import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scanBarcodePhoto } from '@/services/barcodesService'
import { queueLabelScan } from '@/services/labelScansService'
import { consumeProduct, createProduct, reassignIcons } from '@/services/productsService'
import { triggerAlert } from '@/services/settingsService'
import {
  DEFAULT_TIMEOUT_MS,
  ICON_LOOKUP_TIMEOUT_MS,
  ICON_REASSIGN_TIMEOUT_MS,
  LABEL_READ_TIMEOUT_MS,
  PHOTO_UPLOAD_TIMEOUT_MS,
  RECEIPT_READ_TIMEOUT_MS,
  TELEGRAM_SEND_TIMEOUT_MS,
} from '@/services/timeouts'
import { uploadReceipt } from '@/services/tripsService'
import type { ProductPayload } from '@/services/types'
import { extractLabel } from '@/services/visionService'

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { api } = await import('@/services/api')
const mockedApi = vi.mocked(api)

const photo = new Blob(['fake'], { type: 'image/jpeg' })

/** The timeout the one request made was given, if any. */
function timeoutOfTheRequest(): number | undefined {
  expect(mockedApi.post.mock.calls).toHaveLength(1)
  return mockedApi.post.mock.calls[0][2]?.timeout
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.post.mockResolvedValue({ data: {} })
})

/**
 * The wiring, call by call — see #173. The shared instance fails a request
 * after DEFAULT_TIMEOUT_MS; these are the ones that wait on something slower
 * than the database and would be cut off mid-answer without their own limit.
 */
describe('calls that legitimately take longer than the default', () => {
  it.each([
    ['reading a receipt', () => uploadReceipt(photo), RECEIPT_READ_TIMEOUT_MS],
    ['reading one label', () => extractLabel(photo), LABEL_READ_TIMEOUT_MS],
    ['queuing a label photo', () => queueLabelScan(photo), PHOTO_UPLOAD_TIMEOUT_MS],
    ['decoding a barcode photo', () => scanBarcodePhoto(photo), PHOTO_UPLOAD_TIMEOUT_MS],
    ['creating a product, which may ask the model for an icon', () => createProduct({} as ProductPayload), ICON_LOOKUP_TIMEOUT_MS],
    ['reassigning icons', () => reassignIcons(), ICON_REASSIGN_TIMEOUT_MS],
    ['sending the test alert', () => triggerAlert(), TELEGRAM_SEND_TIMEOUT_MS],
  ])('%s gets its own limit', async (_what, call, expected) => {
    await call()

    expect(timeoutOfTheRequest()).toBe(expected)
    expect(expected).toBeGreaterThan(DEFAULT_TIMEOUT_MS)
  })

  it('leaves an ordinary call on the default', async () => {
    await consumeProduct(1)

    expect(timeoutOfTheRequest()).toBeUndefined()
  })
})
