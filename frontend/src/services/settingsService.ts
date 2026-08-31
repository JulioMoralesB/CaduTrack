import { api } from '@/services/api'
import type { AlertSettingsPayload, AlertTriggerResult, SettingsResponse } from '@/services/types'

export async function getSettings(): Promise<SettingsResponse> {
  const { data } = await api.get<SettingsResponse>('/settings')
  return data
}

/** Saving also reschedules the job server-side, so the change takes effect now. */
export async function saveSettings(payload: AlertSettingsPayload): Promise<SettingsResponse> {
  const { data } = await api.put<SettingsResponse>('/settings', payload)
  return data
}

/** Send the alert immediately, to check delivery works. */
export async function triggerAlert(): Promise<AlertTriggerResult> {
  const { data } = await api.post<AlertTriggerResult>('/alerts/trigger')
  return data
}
