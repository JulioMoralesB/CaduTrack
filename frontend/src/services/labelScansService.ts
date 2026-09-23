import { api, apiUrl } from '@/services/api'
import type { LabelScan } from '@/services/types'

/**
 * Queue a label photo to be read in the background — see #134 and
 * POST /label-scans. Returns as soon as the photo is stored, before the
 * model has looked at it; poll getCurrentLabelScans for the result.
 *
 * Not retried, same reasoning as uploadReceipt: this creates a record, so a
 * repeat after a slow connection risks queuing the same photo twice. Same
 * explicit multipart Content-Type as extractLabel, for the same reason.
 */
export async function queueLabelScan(image: Blob): Promise<LabelScan> {
  const form = new FormData()
  form.append('image', image, 'label.jpg')
  const { data } = await api.post<LabelScan>('/label-scans', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/** Every photo still on the checklist, oldest first — empty when none. */
export async function getCurrentLabelScans(): Promise<LabelScan[]> {
  const { data } = await api.get<LabelScan[]>('/label-scans/current')
  return data
}

/** Where the checklist's thumbnail loads the photo itself from. */
export function labelScanImageUrl(scanId: number): string {
  return apiUrl(`/label-scans/${scanId}/image`)
}

/** Queue a failed read for another attempt. Not retried: a one-way status
 *  change, so a repeat after a success gets a 409. */
export async function retryLabelScan(scanId: number): Promise<LabelScan> {
  const { data } = await api.post<LabelScan>(`/label-scans/${scanId}/retry`)
  return data
}

/** Take a photo off the checklist without adding a product. Not retried,
 *  same reasoning as dropTripItem. */
export async function dropLabelScan(scanId: number): Promise<LabelScan> {
  const { data } = await api.post<LabelScan>(`/label-scans/${scanId}/drop`)
  return data
}

/** Link a photo to the product it became — call only after that product
 *  exists. Not retried, same reasoning as resolveTripItem. */
export async function resolveLabelScan(scanId: number, productId: number): Promise<LabelScan> {
  const { data } = await api.post<LabelScan>(`/label-scans/${scanId}/resolve`, { product_id: productId })
  return data
}
