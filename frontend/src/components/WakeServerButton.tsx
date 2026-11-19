import type { WakeServer } from '@/hooks/useWakeServer'

/**
 * "Encender servidor" and what happens after — see useWakeServer. Renders
 * nothing where the feature is not offered.
 */
export function WakeServerButton({ phase, start }: WakeServer) {
  if (phase === 'unavailable') return null

  if (phase === 'waking') {
    return (
      <p className="wake" role="status">
        <span className="spinner" aria-hidden="true" />
        Encendiendo el servidor… puede tardar unos 2 minutos.
      </p>
    )
  }

  return (
    <div className="wake">
      {phase === 'failed' && (
        <p className="wake__problem" role="alert">
          No se pudo pedir que se encienda el servidor.
        </p>
      )}
      {phase === 'timedOut' && (
        <p className="wake__problem" role="alert">
          El servidor no respondió después de 4 minutos.
        </p>
      )}
      <button type="button" className="wake__button" onClick={start}>
        {phase === 'idle' ? 'Encender servidor' : 'Reintentar encender'}
      </button>
    </div>
  )
}
