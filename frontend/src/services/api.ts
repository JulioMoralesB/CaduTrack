import axios, { AxiosError } from 'axios'

const UNREACHABLE = 'No se pudo conectar con el servidor.'
const UNEXPECTED = 'Ocurrió un error inesperado.'

/** Shape of a FastAPI error body: a string, or Pydantic's per-field list. */
interface ApiErrorBody {
  detail?: string | { msg?: string }[]
}

/**
 * The base URL calls go out to, exported so a caller can point a real
 * top-level navigation (not a fetch) at the same host — see isUnreachable's
 * docstring for why that distinction matters.
 *
 * Comes from VITE_API_URL so the same build can talk to a local backend or
 * the one behind the Cloudflare tunnel. It defaults to the relative "/api"
 * path — proxied by the Vite dev server, served by the reverse proxy in
 * production — rather than a hardcoded localhost, so a missing env var does
 * not silently break a deployed build.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

/** Shared Axios instance pointing at the FastAPI backend. */
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * A full, absolute URL to an API path — for a real top-level navigation
 * (`<a href>`, `window.location`), never for `api`'s own requests, which
 * already resolve API_BASE_URL themselves. Resolves against the current
 * origin so a relative API_BASE_URL (the "/api" default) still produces
 * something a new tab can open on its own, detached from this page.
 */
export function apiUrl(path: string): string {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

/**
 * True when `error` looks like the backend could not be reached at all,
 * rather than reached-and-rejected — no response, a network-level failure
 * code, or a bodyless 5xx from a proxy in between.
 *
 * This bucket is deliberately imprecise: it also covers the failure a
 * Cloudflare Access session expiring produces. Access responds to an
 * unauthenticated request with a redirect to its own login page; a `fetch`
 * cannot follow that redirect across origins, so the browser reports it as a
 * plain blocked request with no status and no body — indistinguishable, from
 * here, from the backend being genuinely down. Observed directly: the
 * product list failing to load in production, on every device, with the
 * browser's console (not this code, which never sees enough to say so)
 * showing a CORS error against `*.cloudflareaccess.com`. A `fetch` can never
 * complete Access's interactive login on its own — that needs a real
 * top-level navigation to the protected URL — so an error in this bucket is
 * exactly the case worth offering one for, alongside "the server is down",
 * which the same link is harmless against: it just won't help.
 */
export function isUnreachable(error: unknown): boolean {
  if (!(error instanceof AxiosError)) return false
  const response = (error as AxiosError<ApiErrorBody>).response
  const detail = response?.data?.detail
  return error.code === 'ERR_NETWORK' || response === undefined || (response.status >= 500 && detail === undefined)
}

/**
 * Turn an Axios failure into a message worth showing a user.
 *
 * FastAPI puts a human-readable reason in `detail`; without this the UI would
 * show "Request failed with status code 422", which tells nobody anything.
 */
export function toErrorMessage(error: unknown): string {
  if (!(error instanceof AxiosError)) return UNEXPECTED

  const response = (error as AxiosError<ApiErrorBody>).response
  const detail = response?.data?.detail

  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => item.msg ?? '')
      .filter(Boolean)
      .join('. ')
  }

  return isUnreachable(error) ? UNREACHABLE : UNEXPECTED
}
