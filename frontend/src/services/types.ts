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

/**
 * Best-effort fields read from a photo of a product label — see #83 and
 * POST /vision/label. Any field may be null when the model could not
 * determine it with confidence. Field names match ProductPayload
 * deliberately so a caller can spread this straight into form state.
 */
export interface LabelExtraction {
  name: string | null
  expires_at: string | null
  quantity: string | null
  unit: string | null
}

/** One line read from a receipt photo — see #84 and POST /trips/receipt. */
export interface ShoppingTripItem {
  id: number
  name: string
  quantity: string
  /** The model's own guess at whether this line is worth tracking — drives
   *  the checklist's initial tick state, not a final answer. */
  is_food: boolean
  /** Null while still awaiting a decision. Set once the item was either
   *  turned into a product or explicitly dropped — see product_id. */
  resolved_at: string | null
  /** Set only when resolved_at is set and the item became a product;
   *  resolved with this still null means it was dropped instead. */
  product_id: number | null
}

/**
 * What a scanned barcode resolved to — see #30 and POST /barcodes/lookup.
 * Never carries an expiry date: a barcode does not encode one, so the form
 * this prefills always leaves "Caduca el" for the user to fill in by hand.
 */
export interface BarcodeLookupResult {
  /** The GTIN read from a GS1-128 label, or the raw code as scanned for a
   *  plain EAN/UPC — what remember() and a repeat scan are both keyed on. */
  item_code: string
  /** From a previous remember() call if this code has been scanned before,
   *  otherwise from Open Food Facts, otherwise null (also always null for a
   *  restricted-circulation code — see is_restricted_circulation). */
  name: string | null
  /** Only ever set by a previous remember() call; OFF has no icon of its
   *  own to offer. */
  icon: string | null
  /** Read straight off a GS1-128 label's own (310n) weight field — never
   *  from a remembered value, since the same product can weigh differently
   *  on a later purchase. Null for a plain EAN/UPC, which carries no weight. */
  quantity: string | null
  unit: string | null
}

/** A shopping trip's checklist — see #84. Persists across reloads: the
 *  photo is analyzed once, then the trip stays visible until every item is
 *  either added as a product or dropped. */
export interface ShoppingTrip {
  id: number
  created_at: string
  /** What the receipt's own printed total said, e.g. from "ARTICULOS
   *  COMPRADOS: 19" — null when the receipt didn't show one or the model
   *  couldn't read it, which is different from a mismatch. */
  stated_item_count: number | null
  items: ShoppingTripItem[]
  /** The sum of every line's quantity — the free checksum #84 asks for. */
  counted_quantity: string
  /** Null when there is nothing to reconcile against (stated_item_count is
   *  null); otherwise whether counted_quantity actually matches it. */
  reconciled: boolean | null
}
