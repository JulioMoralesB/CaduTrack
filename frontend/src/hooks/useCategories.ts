import { useEffect, useState } from 'react'

import { listCategories } from '@/services/categoriesService'
import type { Category } from '@/services/types'

/**
 * Categories for the form's select.
 *
 * A failure here is not worth blocking on: the category field is optional, so
 * the form stays usable with an empty list.
 */
export function useCategories(): Category[] {
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const data = await listCategories()
        if (active) setCategories(data)
      } catch {
        if (active) setCategories([])
      }
    })()
    return () => {
      active = false
    }
  }, [])

  return categories
}
