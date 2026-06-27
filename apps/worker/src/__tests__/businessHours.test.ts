import { describe, it, expect } from 'vitest'
import { isWithinBusinessHours } from '../businessHours.js'

const makeDate = (day: number, hour: number, minute = 0) => {
  const d = new Date(2026, 0, 4 + day) // 2026-01-04 is Sunday (day=0)
  d.setHours(hour, minute, 0, 0)
  return d
}

describe('isWithinBusinessHours', () => {
  it('returns true when businessHours is null (24/7)', () => {
    expect(isWithinBusinessHours(null, makeDate(1, 3))).toBe(true)
  })

  it('returns true when current time is within range', () => {
    // Monday 10:00, range 09:00-18:00
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
})
