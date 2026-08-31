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
 */
export function StaleBanner({ cachedAt }: StaleBannerProps) {
  return (
    <p className="stale-banner" role="status">
      Sin conexión — mostrando datos guardados {ageLabel(cachedAt)}
    </p>
  )
}
