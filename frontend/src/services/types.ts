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

/** How a product's icon was decided. See backend/app/models/product.py. */
export type IconSource = 'default' | 'lookup' | 'ai' | 'manual'

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
  /** An emoji. Assigned automatically at creation; never sent on create/replace
   *  — change it with setProductIcon, the only path that can produce 'manual'. */
  icon: string
  icon_source: IconSource
  created_at: string
  updated_at: string
  /** Null while active. Set only by POST /products/{id}/consume, cleared only
   *  by POST /products/{id}/restore — see productsService.ts. */
  consumed_at: string | null
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
  | 'id'
  | 'category'
  | 'icon'
  | 'icon_source'
  | 'created_at'
  | 'updated_at'
  | 'consumed_at'
  | 'days_until_expiry'
  | 'status'
>

export interface AlertSettings {
  enabled: boolean
  /** HH:MM in the server's configured timezone. */
  alert_time: string
  days_ahead: number
  updated_at: string
}

export interface IconSettings {
  ai_enabled: boolean
  updated_at: string
}

export interface SettingsResponse {
  alerts: AlertSettings
  icons: IconSettings
  /** Derived from the server's environment. The token itself is never sent. */
  telegram_configured: boolean
  /** ISO timestamp, or null when nothing is scheduled. */
  next_run_at: string | null
  /** IANA zone the alert time is expressed in. */
  timezone: string
  /** Whether the icon model fallback has anywhere to call — icons.ai_enabled
   *  can be true with this false, the same distinction telegram_configured
   *  draws for alerts. */
  ollama_configured: boolean
  /** The release tag the backend was built from — "dev" outside the release
   *  pipeline. Compared against the frontend's own build-time version. */
  backend_version: string
}

export type AlertSettingsPayload = Pick<AlertSettings, 'enabled' | 'alert_time' | 'days_ahead'>

export type IconSettingsPayload = Pick<IconSettings, 'ai_enabled'>

export interface AlertTriggerResult {
  sent: boolean
  products: number
  detail: string
}

/** Summary of a batch icon reassignment — see POST /products/icons/reassign. */
export interface IconReassignmentResult {
  considered: number
  updated: number
  still_default: number
}
