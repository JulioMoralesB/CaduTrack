import { useCallback, useEffect, useState } from 'react'

import { listCategories } from '@/services/categoriesService'
import type { Category } from '@/services/types'

export interface CategoriesState {
  categories: Category[]
  /** Refetches after a change from Ajustes — see #144. */
  reload: () => Promise<void>
}

/**
 * Categories for the form's select and the filters.
 *
 * A failure here is not worth blocking on: the category field is optional, so
 * the form stays usable with whatever list it last had.
 */
export function useCategories(): CategoriesState {
  const [categories, setCategories] = useState<Category[]>([])

  const reload = useCallback(
    () =>
      listCategories()
        .then(setCategories)
        // Keeps the last list; see above.
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { categories, reload }
}
