import { describe, it, expect } from 'vitest'
import { isWithinBusinessHours, startOfBusinessDay } from '../businessHours.js'

// Fixtures are built as fixed UTC instants (Date.UTC + America/Sao_Paulo's constant UTC-3
// offset — Brazil has had no DST since 2019) so the tests are independent of the machine's
// local timezone, exactly like production. 2026-01-04 is a Sunday.
const makeDate = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 0, 4 + day, hour + 3, minute))

describe('isWithinBusinessHours', () => {
  it('returns true when businessHours is null (24/7)', () => {
    expect(isWithinBusinessHours(null, makeDate(1, 3))).toBe(true)
  })

  it('returns true when current time is within range', () => {
    // Monday 10:00 (America/Sao_Paulo), range 09:00-18:00
    expect(isWithinBusinessHours({ mon: ['09:00', '18:00'] }, makeDate(1, 10))).toBe(true)
  })

  it('returns false when current time is before range start', () => {
    expect(isWithinBusinessHours({ mon: ['09:00', '18:00'] }, makeDate(1, 8, 59))).toBe(false)
  })

  it('returns false when current time is at or after range end', () => {
    expect(isWithinBusinessHours({ mon: ['09:00', '18:00'] }, makeDate(1, 18, 0))).toBe(false)
  })

  it('returns false when the day is not configured', () => {
    // Saturday not in config
    expect(isWithinBusinessHours({ mon: ['09:00', '18:00'] }, makeDate(6, 12))).toBe(false)
  })

  it('evaluates hours in America/Sao_Paulo, not the server local time zone', () => {
    // 2026-01-05T09:30:00Z is Monday 09:30 UTC. A server running in UTC (e.g. a default
    // Docker container) would previously read this as within the 09:00-18:00 range. In
    // America/Sao_Paulo (UTC-3) it's actually 06:30 — before opening.
    const monday0930Utc = new Date(Date.UTC(2026, 0, 5, 9, 30))
    expect(isWithinBusinessHours({ mon: ['09:00', '18:00'] }, monday0930Utc)).toBe(false)
  })
})

describe('startOfBusinessDay', () => {
  it('returns midnight America/Sao_Paulo (03:00 UTC) for the given instant', () => {
    // 2026-01-05T20:00:00Z is still Monday in São Paulo (17:00 local).
    const result = startOfBusinessDay(new Date('2026-01-05T20:00:00Z'))
    expect(result.toISOString()).toBe('2026-01-05T03:00:00.000Z')
  })

  it('rolls back to the previous UTC day when it is already past midnight UTC but not yet in São Paulo', () => {
    // 2026-01-05T01:00:00Z is Sunday 2026-01-04 22:00 in São Paulo — still the same business day
    // as the evening before, even though the UTC calendar date has already advanced.
    const result = startOfBusinessDay(new Date('2026-01-05T01:00:00Z'))
    expect(result.toISOString()).toBe('2026-01-04T03:00:00.000Z')
  })
})
