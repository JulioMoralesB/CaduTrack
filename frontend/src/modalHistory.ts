/**
 * Makes the system back button close the open dialog instead of leaving the
 * app — see #174. On Android, back is the natural way to dismiss a sheet; with
 * no history entry behind a dialog it took the whole app with it, form and all.
 *
 * Each open dialog gets a history entry, and the two are kept in step from
 * one place: `sync()` compares how many dialogs are open with how many
 * entries the current history position accounts for, and pushes or goes back
 * to make them equal. Stated that way rather than as "push on open, back on
 * close" because the simple version breaks in three real cases:
 *
 *   - A receipt or label walk closes one form and opens the next in the same
 *     render. The entry is handed over rather than removed and re-added —
 *     `history.back()` is asynchronous, and a push racing it lands in the
 *     wrong order.
 *   - React's StrictMode mounts every dialog twice in development, which is
 *     that same close-and-reopen.
 *   - A dialog can decline to close (Ajustes, while a save is failing). It is
 *     still open, so it gets its entry back and the next back asks again.
 */

/** Where the count lives in `history.state`, next to whatever else is there. */
const DEPTH_KEY = 'caduModalDepth'

/** How long a closed dialog's entry is left in place before being removed —
 *  long enough for a dialog replacing it to mount and take it over. */
export const MODAL_SETTLE_MS = 30

interface OpenModal {
  close: () => void
}

/** Dialogs currently mounted, oldest first. */
const open: OpenModal[] = []
/** True between asking the browser to go back and its popstate arriving. */
let tidyingUp = false
let syncTimer: number | undefined
let listening = false

/** How many dialog entries the current history position accounts for. */
export function modalDepthInHistory(): number {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null) return 0
  const depth = (state as Record<string, unknown>)[DEPTH_KEY]
  return typeof depth === 'number' ? depth : 0
}

function sync() {
  // Nothing to compare against until the traversal lands; its popstate
  // calls this again.
  if (tidyingUp) return

  const depth = modalDepthInHistory()
  if (depth > open.length) {
    tidyingUp = true
    window.history.go(open.length - depth)
    return
  }
  for (let next = depth + 1; next <= open.length; next += 1) {
    const state: unknown = window.history.state
    const current = typeof state === 'object' && state !== null ? state : {}
    window.history.pushState({ ...current, [DEPTH_KEY]: next }, '')
  }
}

function scheduleSync() {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(sync, MODAL_SETTLE_MS)
}

function onPopState() {
  if (tidyingUp) {
    // Our own step back, removing an entry nobody is using.
    tidyingUp = false
  } else {
    // The back button: everything above where it landed is asked to close,
    // topmost first. Asked, not removed — the dialog leaves `open` when it
    // unmounts, and one that stays is given its entry back by the sync.
    for (const modal of open.slice(modalDepthInHistory()).reverse()) modal.close()
  }
  scheduleSync()
}

/**
 * Register an open dialog; returns what to call when it goes away. `close`
 * is called when the back button reaches it.
 */
export function openModal(close: () => void): () => void {
  if (!listening) {
    window.addEventListener('popstate', onPopState)
    listening = true
  }

  const modal: OpenModal = { close }
  open.push(modal)
  // Right away when there is nothing to wait for, so the entry exists by the
  // time anyone can press back. A no-op when a dialog that just closed left
  // its entry to take over.
  sync()

  return () => {
    const index = open.indexOf(modal)
    if (index !== -1) open.splice(index, 1)
    scheduleSync()
  }
}
