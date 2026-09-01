import { api } from '@/services/api'
import { withRetry } from '@/services/retry'
import type { ShoppingTrip, ShoppingTripItem } from '@/services/types'

/**
 * Read a receipt photo into a new trip's checklist — see #84 and
 * POST /trips/receipt. Persists immediately, unlike extractLabel: the
 * checklist has to survive a reload without asking for the photo again.
 *
 * Not retried, same reasoning as extractLabel: a receipt photo can be
 * several MB, and this call already creates real (if provisional) records
 * server-side — a second attempt after a slow connection risks a duplicate
 * trip, not just wasted time.
 */
export async function uploadReceipt(image: Blob): Promise<ShoppingTrip> {
  const form = new FormData()
  form.append('image', image, 'receipt.jpg')
  const { data } = await api.post<ShoppingTrip>('/trips/receipt', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/** The trip still awaiting attention, or null when there isn't one. */
export async function getCurrentTrip(): Promise<ShoppingTrip | null> {
  const { data } = await api.get<ShoppingTrip | null>('/trips/current')
  return data
}

/** Correct a line's name, quantity, or food classification before
 *  resolving it. */
export async function updateTripItem(
  tripId: number,
  itemId: number,
  payload: { name: string; quantity: string; is_food: boolean },
): Promise<ShoppingTripItem> {
  const { data } = await withRetry(() =>
    api.patch<ShoppingTripItem>(`/trips/${tripId}/items/${itemId}`, payload),
  )
  return data
}

/**
 * Mark a line dealt with without adding a product for it.
 *
 * Not retried, same reasoning as consumeProduct: dropping is a one-way
 * transition, not a value being set, so a repeat that follows a success
 * gets a 409 — an error shown for an action that already worked.
 */
export async function dropTripItem(tripId: number, itemId: number): Promise<ShoppingTripItem> {
  const { data } = await api.post<ShoppingTripItem>(`/trips/${tripId}/items/${itemId}/drop`)
  return data
}

/**
 * Link a line to the product it became — call only after that product
 * already exists, via the normal createProduct.
 *
 * Not retried, same reasoning as dropTripItem above.
 */
export async function resolveTripItem(
  tripId: number,
  itemId: number,
  productId: number,
): Promise<ShoppingTripItem> {
  const { data } = await api.post<ShoppingTripItem>(`/trips/${tripId}/items/${itemId}/resolve`, {
    product_id: productId,
  })
  return data
}
