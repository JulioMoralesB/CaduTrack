/**
 * Theme selection.
 *
 * Stored in localStorage rather than the database: a theme changes nothing on
 * the server, it is reasonable to want dark on a phone and light on a desktop,
 * and a value fetched over the network would flash the wrong palette on every
 * load.
 */

export interface Theme {
  id: string
  name: string
  /** Swatch shown in the picker: background, surface, accent. */
  preview: [string, string, string]
}

export type Mode = 'auto' | 'light' | 'dark'

export const THEMES: Theme[] = [
  { id: 'bosque', name: 'Bosque', preview: ['#f6f7f5', '#ffffff', '#3f7d3a'] },
  { id: 'pizarra', name: 'Pizarra', preview: ['#f4f5f7', '#ffffff', '#4a5568'] },
  { id: 'oceano', name: 'Océano', preview: ['#f2f6fa', '#ffffff', '#2b6cb0'] },
  { id: 'ciruela', name: 'Ciruela', preview: ['#f7f5f8', '#ffffff', '#6d5580'] },
]

export const MODES: { id: Mode; name: string }[] = [
  { id: 'auto', name: 'Según el sistema' },
  { id: 'light', name: 'Claro' },
  { id: 'dark', name: 'Oscuro' },
]

export const DEFAULT_THEME = 'bosque'
export const DEFAULT_MODE: Mode = 'auto'

const THEME_KEY = 'cadutrack:theme'
const MODE_KEY = 'cadutrack:mode'

/** A stored value is only trusted if it still names something that exists. */
export function readTheme(): string {
  const stored = localStorage.getItem(THEME_KEY)
  return THEMES.some((theme) => theme.id === stored) ? (stored as string) : DEFAULT_THEME
}

export function readMode(): Mode {
  const stored = localStorage.getItem(MODE_KEY)
  return MODES.some((mode) => mode.id === stored) ? (stored as Mode) : DEFAULT_MODE
}

export function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Write the resolved choice onto the root element.
 *
 * `auto` is resolved here rather than in CSS. Letting the stylesheet handle it
 * would mean every palette appearing twice — once under a media query, once
 * under a forced mode — with two copies of each value to drift apart.
 */
export function applyTheme(theme: string, mode: Mode): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.mode = mode === 'auto' ? (prefersDark() ? 'dark' : 'light') : mode
}

export function saveTheme(theme: string, mode: Mode): void {
  localStorage.setItem(THEME_KEY, theme)
  localStorage.setItem(MODE_KEY, mode)
  applyTheme(theme, mode)
}

/**
 * Keep `auto` following the system while the app is open.
 *
 * Returns an unsubscribe function. Without this, `auto` would only be correct
 * at load — changing the system theme with the app open would do nothing.
 */
export function watchSystemMode(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
