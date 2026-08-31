import { useEffect, useState, type FormEvent } from 'react'

import { Modal } from '@/components/Modal'
import { ThemePicker } from '@/components/ThemePicker'
import { toErrorMessage } from '@/services/api'
import { reassignIcons } from '@/services/productsService'
import { getSettings, saveIconSettings, saveSettings, triggerAlert } from '@/services/settingsService'
import type { SettingsResponse } from '@/services/types'
import { APP_VERSION } from '@/version'

interface SettingsDialogProps {
  onClose: () => void
  /** Called once after a successful icon reassignment, so the product list
   *  behind the dialog picks up the new icons instead of showing stale ones
   *  until something else happens to trigger a reload. */
  onIconsReassigned: () => void
}

/**
 * Format the server's ISO timestamp as something readable in Spanish.
 *
 * Rendered in the server's zone, not the viewer's: the time field above means
 * server time, so converting this one to the device's zone would put two
 * different hours on the same screen for the same event.
 */
function formatNextRun(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

/**
 * What the version footer should say, and whether it needs the reader's
 * attention.
 *
 * Exists because "¿ya desplegaste v0.11.0?" / "según mí sí" was an actual
 * exchange this app made possible — nothing anywhere said which version was
 * running. Comparing the two independently-built images catches the other
 * failure this same gap allows: a deploy that only pulled one of them.
 */
function versionSummary(backendVersion?: string): { text: string; mismatch: boolean } {
  if (backendVersion === undefined || backendVersion === APP_VERSION) {
    return { text: `CaduTrack ${APP_VERSION}`, mismatch: false }
  }
  return { text: `Frontend ${APP_VERSION} · API ${backendVersion} — no coinciden`, mismatch: true }
}

/** Alert preferences, the icon-assignment toggle, and a way to check delivery
 *  actually works. Two backend resources (see PUT /settings and PUT
 *  /settings/icons), one screen, one Guardar — the split exists to protect
 *  each setting from the other's payload, not to make the user click twice. */
export function SettingsDialog({ onClose, onIconsReassigned }: SettingsDialogProps) {
  const [current, setCurrent] = useState<SettingsResponse | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [alertTime, setAlertTime] = useState('08:00')
  const [daysAhead, setDaysAhead] = useState('7')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [reassignResult, setReassignResult] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const data = await getSettings()
        if (!active) return
        setCurrent(data)
        setEnabled(data.alerts.enabled)
        setAlertTime(data.alerts.alert_time)
        setDaysAhead(String(data.alerts.days_ahead))
        setAiEnabled(data.icons.ai_enabled)
      } catch (caught) {
        if (active) setError(toErrorMessage(caught))
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setTestResult(null)

    void (async () => {
      try {
        // Independent resources, saved together because the dialog only
        // shows one Guardar button — not because the backend expects them
        // to arrive as one payload. Either can fail without the other having
        // partially applied, since each is its own request.
        await Promise.all([
          saveSettings({ enabled, alert_time: alertTime, days_ahead: Number(daysAhead) }),
          saveIconSettings({ ai_enabled: aiEnabled }),
        ])
        // Close on success, as every other app does. The rescheduled next run
        // is still shown on the next open; keeping the dialog up to display it
        // traded the expected behaviour for a confirmation nobody asked for.
        onClose()
      } catch (caught) {
        // A failure is the case that genuinely needs the dialog to stay put.
        setError(toErrorMessage(caught))
      } finally {
        setSaving(false)
      }
    })()
  }

  const handleTest = () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    void (async () => {
      try {
        const result = await triggerAlert()
        setTestResult(result.detail)
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setTesting(false)
      }
    })()
  }

  const handleReassign = () => {
    setReassigning(true)
    setReassignResult(null)
    setError(null)
    void (async () => {
      try {
        const result = await reassignIcons()
        setReassignResult(
          result.considered === 0
            ? 'No hay productos pendientes de icono.'
            : `${result.updated} de ${result.considered} productos actualizados.`,
        )
        if (result.updated > 0) onIconsReassigned()
      } catch (caught) {
        setError(toErrorMessage(caught))
      } finally {
        setReassigning(false)
      }
    })()
  }

  const version = versionSummary(current?.backend_version)

  return (
    <Modal title="Ajustes" onClose={onClose}>
      {current === null && !error && <p className="state state--loading">Cargando…</p>}

      <ThemePicker />

      {current !== null && (
        <form className="form" onSubmit={handleSubmit}>
          <p className={`settings__status settings__status--${current.telegram_configured ? 'ok' : 'missing'}`}>
            {current.telegram_configured
              ? 'Telegram configurado'
              : 'Telegram sin configurar — las alertas no se enviarán'}
          </p>

          <label className="form__field form__field--inline">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Enviar la alerta diaria automáticamente</span>
          </label>

          <div className="form__row">
            <label className="form__field">
              <span>Hora</span>
              <input type="time" value={alertTime} onChange={(e) => setAlertTime(e.target.value)} required />
            </label>

            <label className="form__field">
              <span>Días de anticipación</span>
              <input
                type="number"
                value={daysAhead}
                onChange={(e) => setDaysAhead(e.target.value)}
                min="1"
                max="365"
                required
              />
            </label>
          </div>

          <p className="settings__hint">
            {current.next_run_at
              ? `Próxima alerta: ${formatNextRun(current.next_run_at, current.timezone)}`
              : 'No hay ninguna alerta programada.'}
          </p>

          <p className="settings__section-title">Iconos</p>

          <p className={`settings__status settings__status--${current.ollama_configured ? 'ok' : 'missing'}`}>
            {current.ollama_configured
              ? 'Modelo de iconos configurado'
              : 'Modelo de iconos sin configurar — se usará el icono por defecto'}
          </p>

          <label className="form__field form__field--inline">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            <span>Asignar icono con IA cuando la tabla local no reconozca el producto</span>
          </label>

          <button type="button" onClick={handleReassign} disabled={reassigning}>
            {reassigning ? 'Reasignando…' : 'Reasignar iconos'}
          </button>
          <p className="settings__hint">
            Vuelve a intentar los productos que se quedaron con el icono por defecto — por ejemplo, los que ya
            existían antes de esta función.
          </p>
          {reassignResult && <p className="settings__hint">{reassignResult}</p>}

          {error && (
            <p className="form__error" role="alert">
              {error}
            </p>
          )}
          {testResult && <p className="settings__hint">{testResult}</p>}

          <div className="form__actions">
            <button type="button" onClick={handleTest} disabled={testing || !current.telegram_configured}>
              {testing ? 'Enviando…' : 'Enviar prueba'}
            </button>
            <button type="submit" className="button--primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      {current === null && error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <p className={`settings__version${version.mismatch ? ' settings__version--mismatch' : ''}`}>{version.text}</p>
    </Modal>
  )
}
