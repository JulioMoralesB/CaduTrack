import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BarcodeScanner } from '@/components/BarcodeScanner'

type DecodeCallback = (result: { getText: () => string } | undefined) => void

const zxingControlsStop = vi.fn()
const decodeFromConstraints = vi.fn()

vi.mock('@zxing/browser', () => ({
  // A plain function, not an arrow function: the component calls this with
  // `new`, and an arrow function can never be a constructor — vitest warns
  // about exactly this ("did not use 'function' or 'class'") and `new`-ing
  // it throws, which BarcodeScanner's own catch-all then reports as
  // "No se pudo abrir la cámara.", masking what actually broke.
  BrowserMultiFormatReader: vi.fn(function BrowserMultiFormatReader() {
    return { decodeFromConstraints }
  }),
}))

vi.mock('@zxing/library', () => ({
  BarcodeFormat: { CODE_128: 'code_128', EAN_13: 'ean_13', EAN_8: 'ean_8', UPC_E: 'upc_e' },
  DecodeHintType: { POSSIBLE_FORMATS: 'possible_formats' },
}))

function fakeStream() {
  const stop = vi.fn()
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop }
}

/** jsdom implements neither — both are exercised by the component whenever
 *  the native path runs at all. */
function stubVideoPlayback() {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
}

beforeEach(() => {
  decodeFromConstraints.mockReset()
  zxingControlsStop.mockReset()
  stubVideoPlayback()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
})

describe('BarcodeScanner, native BarcodeDetector available', () => {
  it('reports the first decoded value and stops the camera', async () => {
    const { stream, stop } = fakeStream()
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })

    const detect = vi.fn().mockResolvedValue([{ rawValue: '5449000000996' }])
    // A plain function, not an arrow function — see the @zxing/browser mock
    // above for why: the component new()s this.
    window.BarcodeDetector = vi.fn(function FakeBarcodeDetector() {
      return { detect }
    }) as unknown as typeof BarcodeDetector

    const onDetected = vi.fn()
    render(<BarcodeScanner onDetected={onDetected} onCancel={vi.fn()} />)

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('5449000000996'))
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } })
    expect(stop).toHaveBeenCalled()
  })

  it('shows a permission message when the camera is denied', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new DOMException('denied', 'NotAllowedError')))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    window.BarcodeDetector = vi.fn() as unknown as typeof BarcodeDetector

    render(<BarcodeScanner onDetected={vi.fn()} onCancel={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Se necesita permiso de cámara para escanear.')
  })

  it('shows a generic message for any other camera failure', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('no camera hardware'))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    window.BarcodeDetector = vi.fn() as unknown as typeof BarcodeDetector

    render(<BarcodeScanner onDetected={vi.fn()} onCancel={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir la cámara.')
  })

  it('notifies the caller on cancel, and releases the camera once unmounted', async () => {
    const { stream, stop } = fakeStream()
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    // Never resolves with a barcode — keeps the scan loop alive for Cancel
    // to interrupt. A plain function, not an arrow function — see above.
    window.BarcodeDetector = vi.fn(function FakeBarcodeDetector() {
      return { detect: vi.fn().mockResolvedValue([]) }
    }) as unknown as typeof BarcodeDetector

    const onCancel = vi.fn()
    const { unmount } = render(<BarcodeScanner onDetected={vi.fn()} onCancel={onCancel} />)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())

    // Cancelling itself just notifies the caller — same contract as
    // Modal's own onClose — it is the caller unmounting in response, as
    // ProductForm does, that actually tears the camera down.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()

    unmount()

    expect(stop).toHaveBeenCalled()
  })
})

describe('BarcodeScanner, no native BarcodeDetector', () => {
  it('falls back to zxing and reports its decoded value', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    decodeFromConstraints.mockImplementation((_constraints, _video, callback: DecodeCallback) => {
      callback({ getText: () => '2520157108483' })
      return Promise.resolve({ stop: zxingControlsStop })
    })

    const onDetected = vi.fn()
    render(<BarcodeScanner onDetected={onDetected} onCancel={vi.fn()} />)

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('2520157108483'))
    expect(decodeFromConstraints).toHaveBeenCalledWith(
      { video: { facingMode: 'environment' } },
      expect.anything(),
      expect.any(Function),
    )
  })

  it('ignores a callback fired with no result — a normal miss on one frame', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    decodeFromConstraints.mockImplementation((_constraints, _video, callback: DecodeCallback) => {
      callback(undefined)
      return Promise.resolve({ stop: zxingControlsStop })
    })

    const onDetected = vi.fn()
    render(<BarcodeScanner onDetected={onDetected} onCancel={vi.fn()} />)

    await waitFor(() => expect(decodeFromConstraints).toHaveBeenCalled())
    expect(onDetected).not.toHaveBeenCalled()
  })
})
