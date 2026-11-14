import { useEffect, useRef, type ReactNode } from 'react'

import { openModal } from '@/modalHistory'

interface ModalProps {
  title: string
  onClose: () => void
  /** False while the dialog holds something a stray tap would throw away —
   *  a form with changes in it. The backdrop then does nothing; × and the
   *  dialog's own buttons still close it. See #174. */
  dismissOnBackdrop?: boolean
  children: ReactNode
}

/**
 * Overlay shell for the form and the delete confirmation.
 *
 * Hand-rolled rather than using <dialog>: showModal() is unevenly supported in
 * jsdom, and a modal that cannot be tested is a modal that quietly breaks.
 *
 * The system back button closes it, the same as × — see modalHistory.ts.
 */
export function Modal({ title, onClose, dismissOnBackdrop = true, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // The history entry is tied to the dialog being open, not to one render's
  // onClose — callers pass a new function every render, and re-registering
  // on each would churn the history. The ref keeps back calling the latest.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => openModal(() => onCloseRef.current()), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    // Stop the list behind the overlay from scrolling under the user's thumb.
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  useEffect(() => {
    // Move focus into the panel so keyboard and screen reader users land here.
    panelRef.current?.focus()
  }, [])

  return (
    <div className="modal" onClick={dismissOnBackdrop ? onClose : undefined}>
      <div
        ref={panelRef}
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // The backdrop closes on click (unless told not to); clicks inside
        // the panel never do.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
