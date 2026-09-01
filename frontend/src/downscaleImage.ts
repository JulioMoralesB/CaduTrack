/**
 * Shrink a photo before it ever leaves the device — see #83's live bug
 * report.
 *
 * A real phone photo (3024x4032 measured directly) took 61.5s against the
 * vision model on the actual server, more than double the API's own
 * timeout, and vision models don't read text any more accurately past a
 * point their own patch size already sets — sending the full resolution was
 * pure cost with no upside. 1600px on the long edge measured 23.8s cold,
 * 1.4s warm, on the same server, same label, extracted every field
 * correctly. Re-encoding through canvas is also a forced conversion to
 * JPEG, incidentally ruling out a source format server-side decoding
 * struggles with (HEIC, notably, on an iPhone that didn't convert on
 * capture) as a second, independent way this was failing.
 */

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.85

/** Pure and cheap to test: the actual pixel math, without any canvas or
 *  image-decoding dependency. */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxDimension: number = MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) return { width, height }
  const scale = maxDimension / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Downscale and re-encode `file` as a JPEG Blob, or return it unchanged if
 * anything about that fails — a resize that cannot happen must not block
 * the scan entirely, the same reasoning #83's whole feature already applies
 * to a failed model call: degrade towards manual entry, never towards a
 * dead end.
 */
export async function downscaleImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file

      ctx.drawImage(bitmap, 0, 0, width, height)

      return await new Promise<Blob>((resolve) => {
        canvas.toBlob(
          (blob) => resolve(blob ?? file),
          'image/jpeg',
          JPEG_QUALITY,
        )
      })
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}
