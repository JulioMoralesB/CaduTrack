import { useCallback, useEffect, useState } from 'react'

import { listNameSuggestions } from '@/services/productsService'
import type { ProductNameSuggestion } from '@/services/types'

export interface NameSuggestionsState {
  suggestions: ProductNameSuggestion[]
  /** Refetches after a category is deleted, so no suggestion keeps pointing
   *  at it — see #144. */
  reload: () => Promise<void>
}

/**
 * Previously used product names, for the form's own autocomplete — see #133.
 *
 * A failure here is not worth blocking on, same reasoning as useCategories:
 * the feature is a convenience, so the form stays fully usable without it.
 */
export function useNameSuggestions(): NameSuggestionsState {
  const [suggestions, setSuggestions] = useState<ProductNameSuggestion[]>([])

  const reload = useCallback(
    () =>
      listNameSuggestions()
        .then(setSuggestions)
        // Keeps the last list; see above.
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { suggestions, reload }
}
