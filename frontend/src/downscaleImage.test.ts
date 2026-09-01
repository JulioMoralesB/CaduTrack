import { describe, expect, it } from 'vitest'

import { computeTargetDimensions, downscaleImage } from '@/downscaleImage'

describe('computeTargetDimensions', () => {
  it('leaves an image already within the limit untouched', () => {
    expect(computeTargetDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('leaves an image exactly at the limit untouched', () => {
    expect(computeTargetDimensions(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('scales a portrait photo down by its longer edge', () => {
    // The exact shape of the real phone photo that motivated this — see the
    // module docstring. Cross-checked against Pillow's own thumbnail() on
    // the same dimensions: (1200, 1600).
    expect(computeTargetDimensions(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('scales a landscape photo down by its longer edge', () => {
    expect(computeTargetDimensions(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
  })
})

describe('downscaleImage', () => {
  it('falls back to the original file when resizing is not available', async () => {
    // jsdom has neither createImageBitmap nor a real <canvas> — exercising
    // exactly the fallback path a real browser would also take if either
    // failed, per the module's own reasoning: a resize that cannot happen
    // must not block the scan.
    const file = new File(['fake'], 'label.jpg', { type: 'image/jpeg' })

    const result = await downscaleImage(file)

    expect(result).toBe(file)
  })
})
