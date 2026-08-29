import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * Overlay shell for the form and the delete confirmation.
 *
 * Hand-rolled rather than using <dialog>: showModal() is unevenly supported in
 * jsdom, and a modal that cannot be tested is a modal that quietly breaks.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

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
    <div className="modal" onClick={onClose}>
      <div
        ref={panelRef}
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // The backdrop closes on click; clicks inside the panel must not.
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
