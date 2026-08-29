import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import { toErrorMessage } from '@/services/api'

function axiosErrorWith(data: unknown, status = 422): AxiosError {
  const error = new AxiosError('Request failed')
  error.response = {
    data,
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  }
  return error
}

describe('toErrorMessage', () => {
  it("surfaces FastAPI's detail string instead of the HTTP status", () => {
    expect(toErrorMessage(axiosErrorWith({ detail: 'Category 9999 does not exist' }))).toBe(
      'Category 9999 does not exist',
    )
  })

  it('joins the per-field errors Pydantic returns', () => {
    const error = axiosErrorWith({ detail: [{ msg: 'Field required' }, { msg: 'Input should be greater than 0' }] })
    expect(toErrorMessage(error)).toBe('Field required. Input should be greater than 0')
  })

  it('explains a network failure in plain language', () => {
    const error = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(toErrorMessage(error)).toBe('No se pudo conectar con el servidor.')
  })

  it('treats a bodyless 500 as the backend being down', () => {
    // What the Vite dev server returns when it cannot reach the API.
    expect(toErrorMessage(axiosErrorWith('', 500))).toBe('No se pudo conectar con el servidor.')
  })

  it('treats a gateway error as the backend being down', () => {
    expect(toErrorMessage(axiosErrorWith({}, 502))).toBe('No se pudo conectar con el servidor.')
  })

  it('still shows a real server error that came with a reason', () => {
    expect(toErrorMessage(axiosErrorWith({ detail: 'Internal Server Error' }, 500))).toBe(
      'Internal Server Error',
    )
  })

  it('falls back for anything that is not an Axios error', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('Ocurrió un error inesperado.')
  })
})
