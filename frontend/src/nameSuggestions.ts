import { normalizeProductName } from '@/duplicateCheck'
import { normalizeForSearch } from '@/filters'
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

const MIN_QUERY_LENGTH = 2
const MAX_MATCHES = 5

/**
 * Previously used names to offer while one is being typed — see #160.
 * Ignores case and accents, names starting with what was typed come first,
 * and a name already typed in full is left out: there's nothing to offer.
 */
export function matchNameSuggestions(
  suggestions: ProductNameSuggestion[],
  typed: string,
): ProductNameSuggestion[] {
  const query = normalizeForSearch(typed)
  if (query.length < MIN_QUERY_LENGTH) return []

  const typedName = normalizeProductName(typed)
  const searchable = suggestions
    .filter((suggestion) => normalizeProductName(suggestion.name) !== typedName)
    .map((suggestion) => ({ suggestion, name: normalizeForSearch(suggestion.name) }))
    .filter(({ name }) => name.includes(query))

  return [
    ...searchable.filter(({ name }) => name.startsWith(query)),
    ...searchable.filter(({ name }) => !name.startsWith(query)),
  ]
    .slice(0, MAX_MATCHES)
    .map(({ suggestion }) => suggestion)
}
