import { useEffect, useState } from 'react'

import {
  MODES,
  THEMES,
  applyTheme,
  readMode,
  readTheme,
  saveTheme,
  watchSystemMode,
  type Mode,
} from '@/theme'

/** Theme and light/dark selection. Applies immediately, no save button. */
export function ThemePicker() {
  const [theme, setTheme] = useState(readTheme)
  const [mode, setMode] = useState<Mode>(readMode)

  // With `auto` chosen, the system can change while the app is open. Without
  // this the choice would only be correct at load.
  useEffect(() => watchSystemMode(() => applyTheme(theme, mode)), [theme, mode])

  const choose = (nextTheme: string, nextMode: Mode) => {
    setTheme(nextTheme)
    setMode(nextMode)
    saveTheme(nextTheme, nextMode)
  }

  return (
    <fieldset className="theme">
      <legend>Apariencia</legend>

      <div className="theme__swatches" role="radiogroup" aria-label="Tema">
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === theme}
            aria-label={option.name}
            title={option.name}
            className={`theme__swatch${option.id === theme ? ' theme__swatch--active' : ''}`}
            onClick={() => choose(option.id, mode)}
          >
            <span className="theme__colors" aria-hidden="true">
              {option.preview.map((colour) => (
                <span key={colour} style={{ background: colour }} />
              ))}
            </span>
            <span className="theme__name">{option.name}</span>
          </button>
        ))}
      </div>

      <label className="form__field">
        <span>Claro u oscuro</span>
        <select value={mode} onChange={(event) => choose(theme, event.target.value as Mode)}>
          {MODES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}
