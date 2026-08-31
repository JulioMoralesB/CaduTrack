import { useEffect, useState, type FormEvent } from 'react'

import { Modal } from '@/components/Modal'
import { toErrorMessage } from '@/services/api'
import { getSettings, saveSettings, triggerAlert } from '@/services/settingsService'
import type { SettingsResponse } from '@/services/types'

interface SettingsDialogProps {
  onClose: () => void
}

/** Format the server's ISO timestamp as something readable in Spanish. */
function formatNextRun(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Alert preferences, and a way to check delivery actually works. */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [current, setCurrent] = useState<SettingsResponse | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [alertTime, setAlertTime] = useState('08:00')
  const [daysAhead, setDaysAhead] = useState('7')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

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
        // The response carries the rescheduled next run, so the user sees the
        // change take effect rather than having to trust it.
        setCurrent(await saveSettings({ enabled, alert_time: alertTime, days_ahead: Number(daysAhead) }))
      } catch (caught) {
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

  return (
    <Modal title="Ajustes de alertas" onClose={onClose}>
      {current === null && !error && <p className="state state--loading">Cargando…</p>}

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
              ? `Próxima alerta: ${formatNextRun(current.next_run_at)}`
              : 'No hay ninguna alerta programada.'}
          </p>

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
    </Modal>
  )
}
