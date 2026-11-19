/** Spanish UI labels for the language-neutral keys the API stores. */

import type { Location } from '@/services/types'

export const LOCATION_LABELS: Record<Location, string> = {
  fridge: 'Refrigerador',
  freezer: 'Congelador',
  pantry: 'Alacena',
}

/**
 * Phrase a day count the way a person would say it.
 *
 * "Caduca en 0 días" is how a machine talks; the whole point of the list is
 * being scannable at a glance.
 */
export function expiryPhrase(daysUntilExpiry: number): string {
  if (daysUntilExpiry < 0) {
    const days = Math.abs(daysUntilExpiry)
    return days === 1 ? 'Caducó ayer' : `Caducó hace ${days} días`
  }
  if (daysUntilExpiry === 0) return 'Caduca hoy'
  if (daysUntilExpiry === 1) return 'Caduca mañana'
  return `Caduca en ${daysUntilExpiry} días`
}

/**
 * Singular and plural of the units the form suggests — see #177. The chips
 * mix the two ("piezas", "bolsa"), so whatever was stored is shown as is
 * would read "1 litros" or "2 paquete". Abbreviations (kg, g, ml) don't
 * change, and a unit typed by hand is left exactly as typed.
 */
const UNIT_FORMS: ReadonlyArray<readonly [singular: string, plural: string]> = [
  ['pieza', 'piezas'],
  ['litro', 'litros'],
  ['bolsa', 'bolsas'],
  ['paquete', 'paquetes'],
  ['lata', 'latas'],
]

/** `unit` in the form that agrees with `amount`: singular for exactly one. */
function agreeingUnit(unit: string, amount: string): string {
  const lower = unit.toLowerCase()
  const forms = UNIT_FORMS.find(([singular, plural]) => lower === singular || lower === plural)
  if (!forms) return unit
  const wanted = amount === '1' ? forms[0] : forms[1]
  // Same capitalisation as stored: "Litros" stays capitalised.
  return unit[0] === unit[0].toUpperCase() ? wanted[0].toUpperCase() + wanted.slice(1) : wanted
}

/** Quantity and unit as one string, skipping the unit when there is none. */
export function quantityLabel(quantity: string, unit: string | null): string {
  // The API sends NUMERIC(10,2) as a string, so whole amounts arrive as "2.00".
  // Trim trailing zeros without touching meaningful decimals: 2.00 -> 2,
  // 1.50 -> 1.5, 1.25 -> 1.25.
  const amount = quantity.includes('.') ? quantity.replace(/0+$/, '').replace(/\.$/, '') : quantity
  return unit ? `${amount} ${agreeingUnit(unit, amount)}` : amount
}

/** "22 sep" — a timestamp as the device's own calendar day, for telling
 *  one receipt from another at a glance. See #153. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

/** "1 sep" for a date-only value such as an expiry date ("2026-09-01").
 *  Built from its parts: new Date("2026-09-01") is UTC midnight, which is
 *  still the day before in Mexico. */
export function dayMonth(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

