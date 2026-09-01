import { api } from '@/services/api'
import type { LabelExtraction } from '@/services/types'

/**
 * Read a name, expiry date, and weight from a photo of a product label —
 * see #83 and POST /vision/label. Never saves anything; the result is meant
 * to pre-fill the product form for the user to confirm or correct.
 *
 * Not retried: a label photo can be several MB, so a second attempt after a
 * slow or dropped connection costs real time and mobile data on a call that
 * is read-only anyway — the user can just try again if it fails, in which
 * case an automatic retry would only be racing them.
 *
 * The explicit Content-Type override matters: the shared `api` instance
 * defaults to "application/json", and axios's FormData handling only skips
 * JSON-stringifying the body when the request's Content-Type does *not*
 * already look like JSON — reproduced directly against the real backend,
 * which received a 422 "field required" for `image` without this override,
 * because the file never left as multipart at all.
 */
export async function extractLabel(image: File): Promise<LabelExtraction> {
  const form = new FormData()
  form.append('image', image)
  const { data } = await api.post<LabelExtraction>('/vision/label', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}
