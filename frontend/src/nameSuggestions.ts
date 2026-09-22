import { normalizeProductName } from '@/duplicateCheck'
import type { ProductNameSuggestion } from '@/services/types'

/**
 * The suggestion this name exactly matches, if any — see #133.
 *
 * Same exact-once-normalized standard as findDuplicateToday, for the same
 * reason: a fuzzy match here would occasionally overwrite a category or
 * location the user meant to pick themselves with a wrong guess, which
 * costs more trust than an unmatched name that just falls back to typing
 * it out.
 */
export function findNameSuggestion(
  suggestions: ProductNameSuggestion[],
  name: string,
): ProductNameSuggestion | null {
  const normalized = normalizeProductName(name)
  if (!normalized) return null

  return suggestions.find((suggestion) => normalizeProductName(suggestion.name) === normalized) ?? null
}
