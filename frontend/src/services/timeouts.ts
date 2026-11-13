/**
 * How long a request may go unanswered before it fails — see #173.
 *
 * Without a limit a request on a weak signal can hang with no response at
 * all, and "Guardando…" stays up with nothing to say it isn't coming back.
 * A timeout turns that into the same "No se pudo conectar con el servidor"
 * as any other unreachable server (see api.ts), and is never retried
 * automatically (see retry.ts: the write may have landed).
 *
 * Kept apart from api.ts so the service tests that replace that module
 * wholesale still see the real values.
 */

/** Everything that only waits on the API and its database: short enough to
 *  fail while the person is still looking at the button they tapped. */
export const DEFAULT_TIMEOUT_MS = 15_000

/*
 * The calls below wait on something slower. Each allows what the backend
 * itself allows that step, plus room for the request to get there — on the
 * connection this exists for, a photo upload alone can take a while.
 */

/** Creating a product: an unknown name may ask the model for an icon, which
 *  the backend gives 15s (ollama_client.TIMEOUT_SECONDS). */
export const ICON_LOOKUP_TIMEOUT_MS = 30_000

/** Reassigning icons asks the model once per product still at the default,
 *  one after another, so it has no fixed ceiling. Past this the page stops
 *  waiting; the server carries on, and a reload shows what it got done. */
export const ICON_REASSIGN_TIMEOUT_MS = 120_000

/** The test alert waits on Telegram, which the backend gives 10s to connect
 *  and 10s more to answer (telegram.TIMEOUT_SECONDS). */
export const TELEGRAM_SEND_TIMEOUT_MS = 30_000

/** A photo the server only stores or decodes itself — a queued label, a
 *  barcode. The upload is the slow part. */
export const PHOTO_UPLOAD_TIMEOUT_MS = 60_000

/** One label read while the form waits: the upload, then the vision model,
 *  which the backend gives 45s (vision_client.TIMEOUT_SECONDS). */
export const LABEL_READ_TIMEOUT_MS = 90_000

/** A receipt: the upload, the read (120s) and the name expansion (30s) —
 *  see receipt_client. nginx allows the same 150s between bytes. */
export const RECEIPT_READ_TIMEOUT_MS = 180_000
