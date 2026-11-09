import { useCallback, useEffect, useState } from 'react'

import { CategoryManager } from '@/components/CategoryManager'
import { Modal } from '@/components/Modal'
import { ThemePicker } from '@/components/ThemePicker'
import { useAutosave } from '@/hooks/useAutosave'
import { toErrorMessage } from '@/services/api'
import { reassignIcons } from '@/services/productsService'
import { getSettings, saveIconSettings, saveSettings, triggerAlert } from '@/services/settingsService'
import type { AlertSettingsPayload, Category, IconSettingsPayload, Product, SettingsResponse } from '@/services/types'
import { APP_VERSION } from '@/version'

interface SettingsDialogProps {
  categories: Category[]
  /** The active product list, to say what deleting a category would touch. */
  products: Product[]
  onClose: () => void
  /** Called once after a successful icon reassignment, so the product list
   *  behind the dialog picks up the new icons instead of showing stale ones
   *  until something else happens to trigger a reload. */
  onIconsReassigned: () => void
  /** Called after any category change, with the id if one was deleted. */
  onCategoriesChanged: (deletedId?: number) => Promise<void>
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

/** Long enough that typing "14" doesn't save "1" first, and reschedule the
 *  daily job for it, on the way there. */
const SAVE_DELAY_MS = 600

/** What the alert fields would send, or why they can't send it yet. Mid-edit
 *  values (a cleared time, an empty number) are normal, not failures. */
function validateAlerts(
  enabled: boolean,
  alertTime: string,
  daysAhead: string,
): { payload: AlertSettingsPayload } | { problem: string } {
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(alertTime)) return { problem: 'Elige una hora.' }
  const days = Number(daysAhead)
  if (daysAhead.trim() === '' || !Number.isInteger(days) || days < 1 || days > 365) {
    return { problem: 'Los días de anticipación van de 1 a 365.' }
  }
  return { payload: { enabled, alert_time: alertTime, days_ahead: days } }
}

/** Alert preferences, the icon-assignment toggle, and a way to check delivery
 *  actually works. Every change saves itself, the same as the theme picker —
 *  see #146: a Guardar below the fold made it easy to change the alert time
 *  and close without saving. Two backend resources (see PUT /settings and
 *  PUT /settings/icons), each with its own autosave, so neither ever has to
 *  resend the other's values. */
export function SettingsDialog({
  categories,
  products,
  onClose,
  onIconsReassigned,
  onCategoriesChanged,
}: SettingsDialogProps) {
  const [current, setCurrent] = useState<SettingsResponse | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [alertTime, setAlertTime] = useState('08:00')
  const [daysAhead, setDaysAhead] = useState('7')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alertProblem, setAlertProblem] = useState<string | null>(null)
  // Set when closing found a change that couldn't be saved: the first close
  // stays open to say so, the next one leaves — offline must not be a trap.
  const [closeBlocked, setCloseBlocked] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [reassignResult, setReassignResult] = useState<string | null>(null)

  const persistAlerts = useCallback(async (payload: AlertSettingsPayload) => {
    // The response carries the rescheduled next run, for the hint below.
    setCurrent(await saveSettings(payload))
  }, [])
  const persistIcons = useCallback((payload: IconSettingsPayload) => saveIconSettings(payload), [])

  const alerts = useAutosave(persistAlerts, SAVE_DELAY_MS)
  const icons = useAutosave(persistIcons, SAVE_DELAY_MS)

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

  const changeAlerts = (next: { enabled?: boolean; alertTime?: string; daysAhead?: string }) => {
    const values = { enabled, alertTime, daysAhead, ...next }
    setEnabled(values.enabled)
    setAlertTime(values.alertTime)
    setDaysAhead(values.daysAhead)
    setCloseBlocked(false)

    const result = validateAlerts(values.enabled, values.alertTime, values.daysAhead)
    if ('problem' in result) {
      setAlertProblem(result.problem)
      alerts.cancel()
    } else {
      setAlertProblem(null)
      alerts.schedule(result.payload)
    }
  }

  const changeAiEnabled = (value: boolean) => {
    setAiEnabled(value)
    setCloseBlocked(false)
    icons.schedule({ ai_enabled: value })
  }

  const handleClose = () => {
    void (async () => {
      const [alertsSaved, iconsSaved] = await Promise.all([alerts.flush(), icons.flush()])
      if ((alertsSaved && iconsSaved) || closeBlocked) onClose()
      else setCloseBlocked(true)
    })()
  }

  const handleTest = () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    void (async () => {
      try {
        // The test should use what's on screen, not what was saved last.
        if (await alerts.flush()) {
          const result = await triggerAlert()
          setTestResult(result.detail)
        }
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
        // Reassigning reads the AI toggle, which may still be on its way.
        if (!(await icons.flush())) return
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

  const versionLine = (
    <p className={`settings__version${version.mismatch ? ' settings__version--mismatch' : ''}`}>{version.text}</p>
  )

  const saveError = alerts.error ?? icons.error
  const saving = alerts.status === 'saving' || icons.status === 'saving'
  const saved = alerts.status === 'saved' || icons.status === 'saved'

  return (
    <Modal title="Ajustes" onClose={handleClose}>
      {current === null && !error && <p className="state state--loading">Cargando…</p>}

      <ThemePicker />

      {current !== null && (
        <div className="form">
          <p className={`settings__status settings__status--${current.telegram_configured ? 'ok' : 'missing'}`}>
            {current.telegram_configured
              ? 'Telegram configurado'
              : 'Telegram sin configurar — las alertas no se enviarán'}
          </p>

          <label className="form__field form__field--inline">
            <input type="checkbox" checked={enabled} onChange={(e) => changeAlerts({ enabled: e.target.checked })} />
            <span>Enviar la alerta diaria automáticamente</span>
          </label>

          <div className="form__row">
            <label className="form__field">
              <span>Hora</span>
              <input type="time" value={alertTime} onChange={(e) => changeAlerts({ alertTime: e.target.value })} />
            </label>

            <label className="form__field">
              <span>Días de anticipación</span>
              <input
                type="number"
                value={daysAhead}
                onChange={(e) => changeAlerts({ daysAhead: e.target.value })}
                min="1"
                max="365"
              />
            </label>
          </div>

          {alertProblem && (
            <p className="form__error" role="alert">
              {alertProblem}
            </p>
          )}

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
            <input type="checkbox" checked={aiEnabled} onChange={(e) => changeAiEnabled(e.target.checked)} />
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

          <CategoryManager categories={categories} products={products} onChanged={onCategoriesChanged} />

          {error && (
            <p className="form__error" role="alert">
              {error}
            </p>
          )}
          {testResult && <p className="settings__hint">{testResult}</p>}

          {versionLine}

          {/* Pinned, the same as ProductForm's — see #142: this sheet is far
              taller than a phone screen, and whether a change saved has to be
              visible from wherever it was made. */}
          <div className="form__footer">
            {saveError ? (
              <p className="form__error" role="alert">
                No se guardó: {saveError}
                {closeBlocked && ' Cierra otra vez para salir sin guardar.'}
              </p>
            ) : (
              <p className="settings__save-status" role="status">
                {saving ? 'Guardando…' : saved ? 'Guardado' : ''}
              </p>
            )}
            <div className="form__actions">
              <button type="button" onClick={handleTest} disabled={testing || !current.telegram_configured}>
                {testing ? 'Enviando…' : 'Enviar prueba'}
              </button>
              {/* Not "Cerrar": the modal's own × already carries that name. */}
              <button type="button" className="button--primary" onClick={handleClose}>
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {current === null && error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      {current === null && versionLine}
    </Modal>
  )
}
