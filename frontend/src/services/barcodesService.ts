import { api } from '@/services/api'
import type { BarcodeLookupResult } from '@/services/types'

/**
 * Decode a barcode from a photo taken with the phone's own camera — see
 * #132 and POST /barcodes/scan-photo. Replaces the old live in-browser
 * video scan; the raw value this returns is handed to lookupBarcode below
 * exactly as a live scanner's own detected value used to be.
 *
 * Not retried, same reasoning as extractLabel: the user can just take the
 * photo again, and a scan happens far more often than it fails.
 */
export async function scanBarcodePhoto(image: Blob): Promise<{ raw: string }> {
  const form = new FormData()
  form.append('image', image, 'barcode.jpg')
  const { data } = await api.post<{ raw: string }>('/barcodes/scan-photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/**
 * Resolve a scanned code — see #30 and POST /barcodes/lookup. Side-effect
 * free, same contract as extractLabel: nothing is saved, the result is
 * only meant to pre-fill the product form for the user to confirm.
 *
 * Not retried, same reasoning as extractLabel: the user can just point the
 * camera again, and a scan happens far more often than it fails.
 */
export async function lookupBarcode(code: string): Promise<BarcodeLookupResult> {
  const { data } = await api.post<BarcodeLookupResult>('/barcodes/lookup', { code })
  return data
}

/**
 * Record what a scanned code turned out to be — call only after the
 * product it identified was actually created, via the normal createProduct,
 * same "call only after it already exists" contract as resolveTripItem.
 *
 * Not retried, same reasoning as resolveTripItem: this is a best-effort
 * cache write behind an already-successful save, not something worth
 * troubling the user over if it fails.
 */
export async function rememberBarcode(itemCode: string, name: string, icon: string | null): Promise<void> {
  await api.post(`/barcodes/${encodeURIComponent(itemCode)}/remember`, { name, icon })
}
