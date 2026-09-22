import { useEffect, useState } from 'react'

import { listNameSuggestions } from '@/services/productsService'
import type { ProductNameSuggestion } from '@/services/types'

/**
 * Previously used product names, for the form's own autocomplete — see #133.
 *
 * A failure here is not worth blocking on, same reasoning as useCategories:
 * the feature is a convenience, so the form stays fully usable with an empty
 * list.
 */
export function useNameSuggestions(): ProductNameSuggestion[] {
  const [suggestions, setSuggestions] = useState<ProductNameSuggestion[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const data = await listNameSuggestions()
        if (active) setSuggestions(data)
      } catch {
        if (active) setSuggestions([])
      }
    })()
    return () => {
      active = false
    }
  }, [])

  return suggestions
}
