/**
 * Stepping a quantity by whole units, without floating-point drift and
 * without rounding away precision the product already carries.
 *
 * `quantity` mirrors the API's `NUMERIC(10, 2)` column: at most two decimal
 * places, never zero or negative (`CheckConstraint("quantity > 0")`). Cents
 * arithmetic — scale to an integer, add, scale back — sidesteps the case
 * where plain float math would turn "0.59 + 1" into "1.5900000000000001".
 */

const CENTS_PER_UNIT = 100

function toCents(quantity: string): number | null {
  // Number('') is 0, not NaN — without this an empty field would step to "1"
  // instead of being left alone for the required-field validation to catch.
  if (quantity.trim() === '') return null
  const value = Number(quantity)
  return Number.isFinite(value) ? Math.round(value * CENTS_PER_UNIT) : null
}

function fromCents(cents: number): string {
  const fixed = (cents / CENTS_PER_UNIT).toFixed(2)
  // Trim trailing zeros the same way the rest of the app displays a quantity
  // (see quantityLabel in labels.ts): "3.00" -> "3", "1.50" -> "1.5".
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

/**
 * True when decrementing by one whole unit would still leave a positive
 * quantity. Used to disable "−" rather than let it produce a value the API
 * would reject — see #82: the button simply stops at 1, it does not offer a
 * path to zero.
 */
export function canStepDown(quantity: string): boolean {
  const cents = toCents(quantity)
  return cents !== null && cents > CENTS_PER_UNIT
}

/**
 * Add or subtract one whole unit. Returns `current` unchanged if the result
 * would not be a positive number — callers that also disable the button
 * (the card) get a no-op backstop; the form's stepper, which has no delta
 * endpoint to reject an invalid value, relies on exactly this guard.
 */
export function stepQuantity(current: string, delta: 1 | -1): string {
  const cents = toCents(current)
  if (cents === null) return current

  const next = cents + delta * CENTS_PER_UNIT
  return next > 0 ? fromCents(next) : current
}
