import { describe, expect, it } from 'vitest'

import { expiryPhrase, quantityLabel } from '@/labels'

describe('expiryPhrase', () => {
  it('says today rather than "in 0 days"', () => {
    expect(expiryPhrase(0)).toBe('Caduca hoy')
  })

  it('uses the singular for tomorrow and yesterday', () => {
    expect(expiryPhrase(1)).toBe('Caduca mañana')
    expect(expiryPhrase(-1)).toBe('Caducó ayer')
  })

  it('counts forwards and backwards', () => {
    expect(expiryPhrase(5)).toBe('Caduca en 5 días')
    expect(expiryPhrase(-3)).toBe('Caducó hace 3 días')
  })
})

describe('quantityLabel', () => {
  it('drops the trailing decimals the API sends for whole amounts', () => {
    expect(quantityLabel('2.00', 'litros')).toBe('2 litros')
  })

  it('trims trailing zeros without losing precision', () => {
    expect(quantityLabel('1.50', 'kg')).toBe('1.5 kg')
    expect(quantityLabel('1.25', 'kg')).toBe('1.25 kg')
    expect(quantityLabel('0.50', 'kg')).toBe('0.5 kg')
  })

  it('omits the unit when there is none', () => {
    expect(quantityLabel('3.00', null)).toBe('3')
  })
})
