import { useEffect, useRef, useState } from 'react'

import { Modal } from '@/components/Modal'

interface BarcodeScannerProps {
  /** Fired once, with the raw decoded value — GS1-128's own AI-prefixed
   *  string or a plain EAN/UPC. Parsing that value is barcode_parser.py's
   *  job, not this component's. */
  onDetected: (raw: string) => void
  onCancel: () => void
}

/**
 * Formats worth decoding for #30. GS1-128 has no dedicated format of its
 * own in either decoder — confirmed against a real generated GS1-128 image
 * cross-checked with zbar — so it has to be requested as plain code_128 and
 * parsed manually afterwards. upc_a is deliberately left out: it is not in
 * the set Chrome's real BarcodeDetector reports as supported.
 */
const FORMATS = ['code_128', 'ean_13', 'ean_8', 'upc_e']

const VIDEO_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: 'environment' } }

/**
 * Live camera barcode scanner — see #30. Prefers the native BarcodeDetector
 * (already on-device, no bundle weight); falls back to zxing-js when it is
 * unavailable, which per the issue is required — Safari and Firefox ship
 * neither BarcodeDetector nor a substitute, so this is the only way #30
 * works there at all.
 */
export function BarcodeScanner({ onDetected, onCancel }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let stopStream: (() => void) | null = null

    const finish = (code: string) => {
      if (cancelled) return
      cancelled = true
      stopStream?.()
      onDetected(code)
    }

    const startNative = async () => {
      const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS)
      // The permission prompt is exactly where a user cancelling this
      // dialog races the grant — if we already unmounted while it was
      // pending, release the camera immediately instead of leaving it on.
      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      stopStream = () => stream.getTracks().forEach((track) => track.stop())
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      const detector = new window.BarcodeDetector!({ formats: FORMATS })
      const tick = async () => {
        if (cancelled || !videoRef.current) return
        try {
          const results = await detector.detect(videoRef.current)
          if (results.length > 0) {
            finish(results[0].rawValue)
            return
          }
        } catch {
          // A single frame that fails to decode is normal mid-scan, not an
          // error worth surfacing — the next frame just tries again.
        }
        if (!cancelled) requestAnimationFrame(() => void tick())
      }
      requestAnimationFrame(() => void tick())
    }

    const startZxing = async () => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ])
      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_E,
      ])
      const reader = new BrowserMultiFormatReader(hints)
      if (cancelled || !videoRef.current) return

      const controls = await reader.decodeFromConstraints(VIDEO_CONSTRAINTS, videoRef.current, (result) => {
        if (result) finish(result.getText())
      })
      // Same unmount-during-permission-prompt race as startNative, but
      // decodeFromConstraints only hands back something to stop once it
      // resolves — stop it right away rather than leaving the camera on.
      if (cancelled) {
        controls.stop()
        return
      }
      stopStream = () => controls.stop()
    }

    void (async () => {
      try {
        if (window.BarcodeDetector) {
          await startNative()
        } else {
          await startZxing()
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof DOMException && caught.name === 'NotAllowedError'
              ? 'Se necesita permiso de cámara para escanear.'
              : 'No se pudo abrir la cámara.',
          )
        }
      }
    })()

    return () => {
      cancelled = true
      stopStream?.()
    }
  }, [onDetected])

  return (
    <Modal title="Escanear código de barras" onClose={onCancel}>
      <div className="barcode-scanner">
        {error ? (
          <p className="form__error" role="alert">
            {error}
          </p>
        ) : (
          <>
            <video ref={videoRef} className="barcode-scanner__video" muted playsInline aria-label="Vista de la cámara" />
            <p className="settings__hint">Apunta la cámara al código de barras.</p>
          </>
        )}
        <div className="form__actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  )
}
