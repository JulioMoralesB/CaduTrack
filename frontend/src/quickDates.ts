/**
 * One-tap expiry dates for the product form — see #142. Most hand-entered
 * dates are "about N from now", which the native date picker makes several
 * taps away.
 */

export interface QuickDate {
  label: string
  days?: number
  months?: number
}

export const QUICK_DATES: QuickDate[] = [
  { label: '+3 días', days: 3 },
  { label: '1 semana', days: 7 },
  { label: '2 semanas', days: 14 },
  { label: '1 mes', months: 1 },
]

/** The date input's own format, in the device's local calendar — not
 *  toISOString(), which is UTC and a day off every evening in Mexico. */
function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function quickDateValue(quick: QuickDate, today: Date = new Date()): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (quick.months) {
    const day = date.getDate()
    date.setMonth(date.getMonth() + quick.months, 1)
    // Jan 31 + 1 month is Feb 28/29, not Mar 3.
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(day, lastDay))
  }
  if (quick.days) date.setDate(date.getDate() + quick.days)
  return toDateInputValue(date)
}
