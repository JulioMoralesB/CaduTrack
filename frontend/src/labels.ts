/** Spanish UI labels for the language-neutral keys the API stores. */

import type { ExpiryStatus, Location } from '@/services/types'

export const LOCATION_LABELS: Record<Location, string> = {
  fridge: 'Refrigerador',
  freezer: 'Congelador',
  pantry: 'Alacena',
}

export const STATUS_LABELS: Record<ExpiryStatus, string> = {
  fresh: 'En buen estado',
  expiring_soon: 'Por caducar',
  expired: 'Caducado',
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

/** Quantity and unit as one string, skipping the unit when there is none. */
export function quantityLabel(quantity: string, unit: string | null): string {
  // The API sends NUMERIC(10,2) as a string, so whole amounts arrive as "2.00".
  // Trim trailing zeros without touching meaningful decimals: 2.00 -> 2,
  // 1.50 -> 1.5, 1.25 -> 1.25.
  const amount = quantity.includes('.') ? quantity.replace(/0+$/, '').replace(/\.$/, '') : quantity
  return unit ? `${amount} ${unit}` : amount
}
