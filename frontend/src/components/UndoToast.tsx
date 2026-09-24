import { useEffect, useState } from 'react'

import { toErrorMessage } from '@/services/api'

/** How long the chance to undo stays up — long enough to notice a
 *  mistaken tap, short enough not to sit over the list. */
export const UNDO_TOAST_MS = 5000

interface UndoToastProps {
  message: string
  /** Runs the undo itself; the toast shows its own busy and error states. */
  onUndo: () => Promise<void>
  onDismiss: () => void
}

/**
 * A short-lived "done · Deshacer" bar at the bottom of the screen — see
 * #143. The caller keys it on what it's about, so a second action replaces
 * the first and restarts its timer.
 */
export function UndoToast({ message, onUndo, onDismiss }: UndoToastProps) {
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Paused while undoing or showing a failure: the bar must not vanish with
  // the outcome still unknown, or with an error nobody got to read.
  useEffect(() => {
    if (undoing || error) return
    const timer = window.setTimeout(onDismiss, UNDO_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [undoing, error, onDismiss])

  const handleUndo = () => {
    setUndoing(true)
    setError(null)
    void (async () => {
      try {
        await onUndo()
        onDismiss()
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setUndoing(false)
      }
    })()
  }

  return (
    <div className="toast" role="status">
      <span className="toast__message">{error ?? message}</span>
      <button type="button" className="toast__action" onClick={handleUndo} disabled={undoing}>
        {undoing ? 'Deshaciendo…' : error ? 'Reintentar' : 'Deshacer'}
      </button>
      {error && (
        <button type="button" className="toast__close" onClick={onDismiss} aria-label="Cerrar aviso">
          ×
        </button>
      )}
    </div>
  )
}
