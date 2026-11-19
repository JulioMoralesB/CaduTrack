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

  it('makes the units the form suggests agree with the amount — see #177', () => {
    expect(quantityLabel('1.00', 'litros')).toBe('1 litro')
    expect(quantityLabel('1.00', 'piezas')).toBe('1 pieza')
    expect(quantityLabel('2.00', 'paquete')).toBe('2 paquetes')
    expect(quantityLabel('3.00', 'lata')).toBe('3 latas')
    expect(quantityLabel('2.00', 'bolsa')).toBe('2 bolsas')
    expect(quantityLabel('1.00', 'bolsa')).toBe('1 bolsa')
    expect(quantityLabel('4.00', 'piezas')).toBe('4 piezas')
  })

  it('treats anything but exactly one as plural', () => {
    expect(quantityLabel('0.50', 'litros')).toBe('0.5 litros')
    expect(quantityLabel('1.50', 'litro')).toBe('1.5 litros')
  })

  it('keeps the capitalisation it was typed with', () => {
    expect(quantityLabel('1.00', 'Litros')).toBe('1 Litro')
  })

  it('leaves abbreviations and units typed by hand alone', () => {
    expect(quantityLabel('1.00', 'kg')).toBe('1 kg')
    expect(quantityLabel('500.00', 'g')).toBe('500 g')
    expect(quantityLabel('1.00', 'ml')).toBe('1 ml')
    expect(quantityLabel('2.00', 'manojo')).toBe('2 manojo')
  })
})
