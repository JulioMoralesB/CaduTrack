import axios, { AxiosError } from 'axios'

const UNREACHABLE = 'No se pudo conectar con el servidor.'
const UNEXPECTED = 'Ocurrió un error inesperado.'

/** Shape of a FastAPI error body: a string, or Pydantic's per-field list. */
interface ApiErrorBody {
  detail?: string | { msg?: string }[]
}

/**
 * Shared Axios instance pointing at the FastAPI backend.
 *
 * The base URL comes from VITE_API_URL so the same build can talk to a local
 * backend or the one behind the Cloudflare tunnel. It defaults to the relative
 * "/api" path — proxied by the Vite dev server, served by the reverse proxy in
 * production — rather than a hardcoded localhost, so a missing env var does not
 * silently break a deployed build.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: { 'Content-Type': 'application/json' },
})

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

  // A backend that is simply down is the most likely failure in practice, and
  // it reaches us in several shapes: no response at all when the browser talks
  // to the API directly, or a gateway error when a proxy is in between. The
  // Vite dev server turns a refused connection into a bodyless 500, so that
  // counts too — telling the user "unexpected error" when the server is off
  // helps nobody.
  const unreachable =
    error.code === 'ERR_NETWORK' ||
    response === undefined ||
    (response.status >= 500 && detail === undefined)

  return unreachable ? UNREACHABLE : UNEXPECTED
}
