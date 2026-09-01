import { api } from '@/services/api'
import type { BarcodeLookupResult } from '@/services/types'

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
