import { MODAL_SETTLE_MS, whenNoDialogIsOpen } from '@/modalHistory'

/**
 * Decides when a new version may reload the page — see #175.
 *
 * A new service worker activates as soon as it is found, and it is looked for
 * every time the app comes back to the foreground (registerServiceWorker.ts).
 * Taking a photo sends the app to the background and brings it back, so right
 * after a deploy the reload landed exactly when a label or barcode was being
 * read: the form, and the photo still being read, were gone.
 *
 * So the reload waits until nothing would be lost by it: no dialog open
 * (modalHistory knows those) and no work in flight that lives outside one —
 * label photos uploading from the list, a receipt being read before its
 * checklist opens. Those hold it with holdReload while they run.
 *
 * Waiting is all it changes. The new version is already in charge of the next
 * load either way; this only picks the moment the running page catches up.
 */

let holds = 0
let pendingReload: (() => void) | null = null
let checkTimer: number | undefined

function reloadIfSafe() {
  if (pendingReload === null || holds > 0) return
  whenNoDialogIsOpen(() => {
    // Looked at again: something may have started while this waited.
    if (pendingReload === null || holds > 0) return
    const reload = pendingReload
    pendingReload = null
    reload()
  })
}

/**
 * Looked at a moment later rather than at once: work that ends by opening a
 * dialog (a receipt read opening its checklist) releases its hold in the same
 * render the dialog mounts in, and the release runs first.
 */
function checkSoon() {
  window.clearTimeout(checkTimer)
  checkTimer = window.setTimeout(reloadIfSafe, MODAL_SETTLE_MS)
}

/** Reload for a new version, as soon as nothing would be lost by it. */
export function reloadWhenSafe(reload: () => void = () => window.location.reload()): void {
  pendingReload = reload
  checkSoon()
}

/** Keep the page from reloading until the returned function is called. */
export function holdReload(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    checkSoon()
  }
}
