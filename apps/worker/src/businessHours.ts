import type { BusinessHours } from '@agente/db'

// Fixed regardless of where the process runs (production containers default to UTC) — business
// hours are always meant in the business's own timezone, not the server's.
const BUSINESS_TIMEZONE = 'America/Sao_Paulo'

const WEEKDAY_TO_KEY: Record<string, keyof BusinessHours> = {
  Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
}

function getZonedDayAndMinutes(date: Date, timeZone: string): { dayKey: keyof BusinessHours | undefined; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const dayKey = WEEKDAY_TO_KEY[get('weekday')]
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  return { dayKey, minutesSinceMidnight: hour * 60 + minute }
}

// Midnight (America/Sao_Paulo) for the day containing `now` — used to scope Agent.daily_message_limit
// to the business's own calendar day rather than the server's. Safe to hardcode the -03:00
// offset: Brazil has used a fixed UTC-3 offset (no DST) since 2019.
export function startOfBusinessDay(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return new Date(`${ymd}T00:00:00-03:00`)
}

export function isWithinBusinessHours(businessHours: BusinessHours | null, now = new Date()): boolean {
  if (businessHours === null) return true

  const { dayKey, minutesSinceMidnight: current } = getZonedDayAndMinutes(now, BUSINESS_TIMEZONE)
  if (!dayKey) return false

  const range = businessHours[dayKey]
  if (!range) return false

  const [startStr, endStr] = range
  const [startHour = 0, startMin = 0] = startStr.split(':').map(Number)
  const [endHour = 0, endMin = 0] = endStr.split(':').map(Number)

  const start = startHour * 60 + startMin
  const end = endHour * 60 + endMin

  return current >= start && current < end
}
