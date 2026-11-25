import { describe, expect, it } from 'vitest'
import {
  describeTimezone,
  timezoneSearchTerms,
  timezoneUtcOffset,
} from './timezone-display'

const WINTER = new Date('2026-01-15T12:00:00.000Z')
const SUMMER = new Date('2026-07-15T12:00:00.000Z')

describe('timezone display', () => {
  it('reads a zone as its city, region and current offset', () => {
    expect(describeTimezone('America/New_York', SUMMER)).toEqual({
      id: 'America/New_York',
      city: 'New York',
      region: 'America',
      offset: 'UTC−4',
      label: 'New York (UTC−4)',
    })
    expect(describeTimezone('America/New_York', WINTER).label).toBe('New York (UTC−5)')
    expect(describeTimezone('Europe/Sofia', SUMMER).label).toBe('Sofia (UTC+3)')
  })

  it('names nested regions and keeps minutes that are not zero', () => {
    expect(describeTimezone('America/Argentina/Buenos_Aires', SUMMER)).toMatchObject({
      city: 'Buenos Aires',
      region: 'America / Argentina',
      offset: 'UTC−3',
    })
    expect(timezoneUtcOffset('Asia/Kolkata', SUMMER)).toBe('UTC+5:30')
    expect(timezoneUtcOffset('Asia/Kathmandu', SUMMER)).toBe('UTC+5:45')
    expect(timezoneUtcOffset('America/St_Johns', WINTER)).toBe('UTC−3:30')
  })

  it('shows UTC plainly and offers no offset for a zone the runtime rejects', () => {
    expect(describeTimezone('UTC', SUMMER)).toMatchObject({ label: 'UTC', region: null })
    expect(timezoneUtcOffset('Europe/London', WINTER)).toBe('UTC+0')
    expect(describeTimezone('Mars/Olympus_Mons', SUMMER)).toMatchObject({
      label: 'Olympus Mons',
      offset: null,
    })
  })

  it('lets a search find a zone by id, city, region or typed offset', () => {
    expect(timezoneSearchTerms(describeTimezone('America/New_York', SUMMER))).toEqual([
      'America/New_York',
      'New York',
      'America',
      'UTC-4',
      'GMT-4',
      '-4',
    ])
  })
})
