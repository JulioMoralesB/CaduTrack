import { describe, expect, it } from 'vitest'

import { QUICK_DATES, quickDateValue } from '@/quickDates'

const byLabel = (label: string) => {
  const quick = QUICK_DATES.find((candidate) => candidate.label === label)
  if (!quick) throw new Error(`no quick date ${label}`)
  return quick
}

describe('quickDateValue', () => {
  it('adds days in the local calendar', () => {
    expect(quickDateValue(byLabel('+3 días'), new Date(2026, 8, 22, 23, 30))).toBe('2026-09-25')
    expect(quickDateValue(byLabel('1 semana'), new Date(2026, 8, 28))).toBe('2026-10-05')
    expect(quickDateValue(byLabel('2 semanas'), new Date(2026, 11, 25))).toBe('2027-01-08')
  })

  it('adds a calendar month, clamping to the last day of a shorter month', () => {
    expect(quickDateValue(byLabel('1 mes'), new Date(2026, 8, 22))).toBe('2026-10-22')
    expect(quickDateValue(byLabel('1 mes'), new Date(2027, 0, 31))).toBe('2027-02-28')
    expect(quickDateValue(byLabel('1 mes'), new Date(2026, 11, 15))).toBe('2027-01-15')
  })
})
