/**
 * A curated set of common emoji for the quick-pick icon grid.
 *
 * Mirrors the distinct values in backend/app/icons.py's lookup table — not a
 * generated copy, so keep the two roughly in sync by hand if either changes
 * meaningfully. Anything not listed here is still reachable through the
 * picker's "Otro" field, which accepts any emoji via the device's own
 * keyboard — this list is a shortcut for the common case, not a ceiling.
 */
export const ICON_CHOICES: readonly string[] = [
  // Frutas
  '🍌', '🍎', '🍐', '🍊', '🍋', '🍓', '🍇', '🍉', '🍈', '🍍', '🥭', '🥝', '🍑', '🥥', '🥑', '🍒', '🫐',
  // Verduras
  '🍅', '🥔', '🧅', '🧄', '🥕', '🥒', '🥬', '🥦', '🌶️', '🫑', '🌽', '🌵', '🍄', '🍆', '🫛', '🫘', '🎃',
  // Lácteos y huevo
  '🥛', '🧀', '🧈', '🥚',
  // Carnes y pescado
  '🥩', '🥓', '🍖', '🍗', '🦃', '🐟', '🍤', '🐙', '🦀',
  // Panadería y granos
  '🍞', '🫓', '🍝', '🍚', '🍪', '🍰', '🥪',
  // Bebidas
  '🧃', '🥤', '☕', '🍵', '🍺', '🍷', '🍫',
  // Condimentos y otros comestibles
  '🧂', '🫒', '🍲', '🍦', '🍕', '🍯',
  // No alimentos
  '🧼', '🧴', '🧻', '🔋', '💡',
]
