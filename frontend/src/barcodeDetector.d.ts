/**
 * The Barcode Detection API — Chrome/Android only as of writing, which is
 * exactly why #30 needs the zxing-js fallback in BarcodeScanner.tsx. Not
 * shipped in TypeScript's own lib.dom.d.ts (checked against 6.0.3), so it
 * has to be declared here instead of coming for free.
 */
interface DetectedBarcode {
  rawValue: string
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] })
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector
}
