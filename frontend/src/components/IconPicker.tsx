import { useState, type KeyboardEvent } from 'react'

import { ICON_CHOICES } from '@/iconChoices'

interface IconPickerProps {
  /** The product's current icon, highlighted in the grid when present there. */
  value: string
  /** Called once with a value actually worth saving — a grid tap, or the
   *  "Otro" field committed non-empty and changed. Never called for a no-op
   *  (unchanged or blank) selection; the picker just closes itself instead. */
  onSelect: (icon: string) => void
  /** Closes the picker without saving — Escape, or leaving "Otro" unchanged. */
  onCancel: () => void
  /** Disables every control while a selection is being saved, so a second tap
   *  cannot fire a second request before the first one settles. */
  busy: boolean
  /** Accessible name for the "Otro" field, e.g. "Cambiar icono de Plátano". */
  label: string
}

/**
 * A quick-pick grid of common emoji, with a text fallback for anything else.
 *
 * Exists because there is no way to make a phone's keyboard open directly to
 * its emoji panel from a plain text input — the user would otherwise have to
 * switch keyboards by hand every time. One tap on a grid entry never needs
 * that at all; "Otro" still falls back to it for whatever is not listed.
 */
export function IconPicker({ value, onSelect, onCancel, busy, label }: IconPickerProps) {
  const [showOther, setShowOther] = useState(false)
  const [draft, setDraft] = useState(value)

  // Tapping the icon already in place is "never mind", the same as leaving
  // "Otro" unchanged — not a request to re-save the value it already has.
  const selectFromGrid = (icon: string) => {
    if (icon === value) {
      onCancel()
      return
    }
    onSelect(icon)
  }

  const commitOther = () => {
    const next = draft.trim()
    if (next === '' || next === value) {
      onCancel()
      return
    }
    onSelect(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commitOther()
    if (event.key === 'Escape') onCancel()
  }

  return (
    <div className="icon-picker">
      <div className="icon-picker__grid" role="group" aria-label="Iconos comunes">
        {ICON_CHOICES.map((icon) => (
          <button
            key={icon}
            type="button"
            className={`icon-picker__option${icon === value ? ' icon-picker__option--selected' : ''}`}
            onClick={() => selectFromGrid(icon)}
            disabled={busy}
            aria-label={icon}
            aria-pressed={icon === value}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="icon-picker__footer">
        {showOther ? (
          <input
            type="text"
            className="icon-picker__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitOther}
            onKeyDown={handleKeyDown}
            disabled={busy}
            maxLength={16}
            autoFocus
            aria-label={label}
          />
        ) : (
          <button type="button" onClick={() => setShowOther(true)} disabled={busy}>
            Otro…
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy} aria-label="Cerrar selector de icono">
          Cerrar
        </button>
      </div>
    </div>
  )
}
