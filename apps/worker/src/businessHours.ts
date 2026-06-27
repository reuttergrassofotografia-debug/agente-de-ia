import type { BusinessHours } from '@agente/db'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export function isWithinBusinessHours(businessHours: BusinessHours | null, now = new Date()): boolean {
  if (businessHours === null) return true

  const dayKey = DAY_KEYS[now.getDay()]
  if (!dayKey) return false

  const range = businessHours[dayKey]
  if (!range) return false

  const [startStr, endStr] = range
  const [startHour = 0, startMin = 0] = startStr.split(':').map(Number)
  const [endHour = 0, endMin = 0] = endStr.split(':').map(Number)

  const current = now.getHours() * 60 + now.getMinutes()
  const start = startHour * 60 + startMin
  const end = endHour * 60 + endMin

  return current >= start && current < end
}
