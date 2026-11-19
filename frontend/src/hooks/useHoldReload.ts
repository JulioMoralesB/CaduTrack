import { useEffect } from 'react'

import { holdReload } from '@/updateGate'

/** Keeps a new version from reloading the page while `active` — see
 *  updateGate.ts and #175. */
export function useHoldReload(active: boolean): void {
  useEffect(() => (active ? holdReload() : undefined), [active])
}
