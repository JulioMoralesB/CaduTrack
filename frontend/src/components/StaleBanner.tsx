import { apiUrl } from '@/services/api'

interface StaleBannerProps {
  cachedAt: Date
}

/** Turn a cache timestamp into something a person can judge. */
function ageLabel(cachedAt: Date): string {
  const minutes = Math.floor((Date.now() - cachedAt.getTime()) / 60000)

  if (minutes < 1) return 'hace unos segundos'
  if (minutes === 1) return 'hace un minuto'
  if (minutes < 60) return `hace ${minutes} minutos`

  const hours = Math.floor(minutes / 60)
  if (hours === 1) return 'hace una hora'
  if (hours < 24) return `hace ${hours} horas`

  const days = Math.floor(hours / 24)
  return days === 1 ? 'hace un día' : `hace ${days} días`
}

/**
 * Says the list is not current.
 *
 * Without this the offline cache would be actively harmful: yesterday's list
 * looks exactly like today's, and you would act on it in front of the fridge.
 *
 * Always offers the same reauth link ProductList's own hard-error state
 * does, for the same reason it is harmless there — see #112. This is the
 * *only* place a Cloudflare Access session expiring is ever visible: the
 * service worker's own NetworkFirst strategy (sw.ts) falls back to this
 * cached copy the moment the live fetch fails for any reason, including
 * Access blocking it, and it does that before axios — where the
 * unreachable-then-offer-reauth logic actually lives — ever sees a
 * failure. A user who already has a cached list, which is every returning
 * user, would otherwise have no way to discover that logging back in is
 * even an option: everything just quietly looks like ordinary offline use,
 * forever.
 */
export function StaleBanner({ cachedAt }: StaleBannerProps) {
  return (
    <div className="stale-banner" role="status">
      <p className="stale-banner__status">Sin conexión — mostrando datos guardados {ageLabel(cachedAt)}</p>
      <p className="stale-banner__hint">
        Si tu sesión expiró, <a href={apiUrl('/reauth')}>reautentícate aquí</a> — te regresa solo
        cuando termines.
      </p>
    </div>
  )
}
