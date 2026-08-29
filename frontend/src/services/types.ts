/** Types mirroring the FastAPI response schemas. */

/** Storage location. Stored as language-neutral keys; labels live in the UI. */
export type Location = 'fridge' | 'freezer' | 'pantry'

/** Urgency bucket computed by the backend. See backend/app/expiry.py. */
export type ExpiryStatus = 'fresh' | 'expiring_soon' | 'expired'

export interface Category {
  id: number
  name: string
  created_at: string
}

export interface Product {
  id: number
  name: string
  category_id: number | null
  /** Serialized as a string: it is a NUMERIC(10,2) and must not lose precision. */
  quantity: string
  unit: string | null
  expires_at: string
  location: Location
  notes: string | null
  category: Category | null
  created_at: string
  updated_at: string
  /** Negative once expired. */
  days_until_expiry: number
  status: ExpiryStatus
}

export interface ProductFilters {
  category_id?: number
  location?: Location
  /** ISO date; matches products expiring strictly before it. */
  expires_before?: string
}

export type ProductPayload = Omit<
  Product,
  'id' | 'category' | 'created_at' | 'updated_at' | 'days_until_expiry' | 'status'
>
