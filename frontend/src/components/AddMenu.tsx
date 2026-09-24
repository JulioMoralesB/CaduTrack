import { useEffect, useRef, useState } from 'react'

interface AddMenuProps {
  onManual: () => void
  onLabels: () => void
  onReceipt: () => void
  labelsBusy: boolean
  receiptBusy: boolean
}

/**
 * The one way into adding products — see #147. Three equal buttons
 * (Recibo / Etiquetas / Agregar producto) crowded the top of the screen and
 * wrapped on a phone; each option here also says when to reach for it.
 *
 * A disclosure (aria-expanded + plain buttons), not an ARIA menu: three
 * options don't need arrow-key menu semantics, and a half-implemented
 * role="menu" is worse for a screen reader than none.
 */
export function AddMenu({ onManual, onLabels, onReceipt, labelsBusy, receiptBusy }: AddMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Closes first, then acts: the file pickers these open take over the
  // screen, and the menu must not still be hanging open behind them.
  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className="add-menu" ref={rootRef}>
      <button
        type="button"
        className="button--primary add-menu__toggle"
        aria-expanded={open}
        aria-controls="add-menu-options"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">+</span> Agregar
      </button>

      {open && (
        <div id="add-menu-options" className="add-menu__options">
          <button type="button" className="add-menu__option" onClick={choose(onManual)}>
            <span className="add-menu__icon" aria-hidden="true">
              ✏️
            </span>
            <span className="add-menu__text">
              <span className="add-menu__title">Un producto</span>
              <span className="add-menu__hint">A mano, con foto o código de barras</span>
            </span>
          </button>
          <button type="button" className="add-menu__option" onClick={choose(onLabels)} disabled={labelsBusy}>
            <span className="add-menu__icon" aria-hidden="true">
              🏷️
            </span>
            <span className="add-menu__text">
              <span className="add-menu__title">Varias etiquetas</span>
              <span className="add-menu__hint">Se leen mientras sigues usando la app</span>
            </span>
          </button>
          <button type="button" className="add-menu__option" onClick={choose(onReceipt)} disabled={receiptBusy}>
            <span className="add-menu__icon" aria-hidden="true">
              🧾
            </span>
            <span className="add-menu__text">
              <span className="add-menu__title">Recibo</span>
              <span className="add-menu__hint">Una foto del ticket de compra</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
