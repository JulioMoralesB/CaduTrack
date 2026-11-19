import { registerSW } from 'virtual:pwa-register'

import { reloadWhenSafe } from '@/updateGate'

/**
 * Registers the service worker and keeps it actually checking for updates.
 *
 * vite-plugin-pwa's default registration (a bare `navigator.serviceWorker.
 * register()` call once on load, wired up automatically when nothing here
 * imports `virtual:pwa-register` itself) only gets a new version onto the
 * device the first time. After that, the browser's own "is there an update"
 * check only runs on a fresh navigation — which a PWA resumed from the home
 * screen may never trigger again once launched, since resuming isn't a new
 * navigation. Reproduced directly: a release sat undetected on a phone that
 * had the app open days earlier, and clearing site data was the only way
 * found to pick it up short of this.
 *
 * registerType: 'autoUpdate' (see vite.config.ts) means an update, once
 * *found*, activates with no prompt. The reload that follows is left to
 * updateGate (#175): it waits until no form is open and no photo is being
 * sent, since coming back from the camera is exactly when this check runs.
 */
export function registerServiceWorker(): void {
  registerSW({
    immediate: true,
    // Previously unhandled: a registration failure had nowhere to go and
    // was silently swallowed — found while verifying this change, in an
    // environment where registration itself failed. Logged rather than
    // surfaced to the user: the app already works without a service worker,
    // just without offline support or background updates, so this is worth
    // knowing about from the console, not worth interrupting anyone over.
    // Instead of registerSW's own immediate window.location.reload().
    onNeedReload() {
      reloadWhenSafe()
    },
    onRegisterError(error) {
      console.error('Service worker registration failed:', error)
    },
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return

      const checkForUpdate = () => {
        void registration.update()
      }

      // Same trigger useProducts already refreshes data on, for the same
      // reason: this app is opened and closed, not left running in the
      // foreground — phone into pocket, phone out of pocket, in front of
      // the fridge. Whatever brings the tab back is also the moment worth
      // asking "is there a newer version yet".
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
      window.addEventListener('online', checkForUpdate)
    },
  })
}
