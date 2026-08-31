import { describe, expect, it } from 'vitest'

import { canStepDown, stepQuantity } from '@/quantity'

describe('stepQuantity', () => {
  it('increments a whole number', () => {
    expect(stepQuantity('2', 1)).toBe('3')
  })

  it('decrements a whole number', () => {
    expect(stepQuantity('5', -1)).toBe('4')
  })

  it('keeps the fractional part exact rather than rounding it away', () => {
    // NUMERIC(10, 2) is the API's real precision boundary — not "no decimals"
    // — so a purchase already carrying cents must keep them after a step.
    expect(stepQuantity('0.59', 1)).toBe('1.59')
  })

  it('does not accumulate floating-point noise across repeated steps', () => {
    let value = '0.10'
    for (let i = 0; i < 5; i += 1) value = stepQuantity(value, 1)
    // Plain float addition (0.1 + 1 + 1 + 1 + 1 + 1) drifts to
    // "5.099999999999999" in JS; cents arithmetic must not.
    expect(value).toBe('5.1')
  })

  it('trims a trailing .00 the same way the rest of the app displays a quantity', () => {
    expect(stepQuantity('2.00', 1)).toBe('3')
  })

  it('trims a trailing zero but keeps a meaningful decimal', () => {
    expect(stepQuantity('1.50', 1)).toBe('2.5')
  })

  it('refuses to go to zero or below, returning the input unchanged', () => {
    expect(stepQuantity('1', -1)).toBe('1')
  })

  it('refuses to cross zero for a fractional quantity smaller than one unit', () => {
    expect(stepQuantity('0.50', -1)).toBe('0.50')
  })

  it('passes non-numeric input through unchanged rather than producing NaN', () => {
    expect(stepQuantity('', 1)).toBe('')
    expect(stepQuantity('abc', -1)).toBe('abc')
  })
})

describe('canStepDown', () => {
  it('is false at exactly 1, the floor the "−" button must stop at', () => {
    expect(canStepDown('1')).toBe(false)
    expect(canStepDown('1.00')).toBe(false)
  })

  it('is false below 1, where a step down would already cross zero', () => {
    expect(canStepDown('0.59')).toBe(false)
  })

  it('is true above 1, including a value that is not itself a whole number', () => {
    expect(canStepDown('1.50')).toBe(true)
    expect(canStepDown('5')).toBe(true)
  })
})
