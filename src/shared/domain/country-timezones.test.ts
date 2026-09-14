import { describe, expect, it } from 'vitest'
import { defaultTimezoneForCountry, timezonesForCountry } from './country-timezones'
import { isValidIanaTimezone } from './timezones'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const EVERY_TWO_LETTER_CODE = [...LETTERS].flatMap((first) =>
  [...LETTERS].map((second) => `${first}${second}`),
)

describe('country timezones', () => {
  it('resolves a single-zone country to its only timezone', () => {
    expect(timezonesForCountry('GB')).toEqual(['Europe/London'])
    expect(defaultTimezoneForCountry('GB')).toBe('Europe/London')
    expect(defaultTimezoneForCountry('FR')).toBe('Europe/Paris')
    expect(defaultTimezoneForCountry('BG')).toBe('Europe/Sofia')
  })

  it('offers every zone of a multi-zone country but never picks one', () => {
    expect(timezonesForCountry('US')).toContain('America/New_York')
    expect(timezonesForCountry('US')).toContain('Pacific/Honolulu')
    expect(timezonesForCountry('DE')).toEqual(['Europe/Berlin', 'Europe/Busingen'])
    expect(timezonesForCountry('ES')).toEqual([
      'Africa/Ceuta',
      'Atlantic/Canary',
      'Europe/Madrid',
    ])
    expect(defaultTimezoneForCountry('US')).toBeNull()
    expect(defaultTimezoneForCountry('DE')).toBeNull()
  })

  it('stores a zone in the spelling the timezone validator accepts', () => {
    // zone.tab names this zone Asia/Kolkata; the validator's runtime lists the
    // CLDR-canonical alias, and a default the validator rejects is no default.
    expect(defaultTimezoneForCountry('IN')).toBe('Asia/Calcutta')
    expect(defaultTimezoneForCountry('VN')).toBe('Asia/Saigon')
  })

  it('normalizes the country code before looking it up', () => {
    expect(timezonesForCountry(' gb ')).toEqual(['Europe/London'])
    expect(defaultTimezoneForCountry('fr')).toBe('Europe/Paris')
  })

  it.each(['', 'ZZ', 'GBR', 'G', '12', '__proto__', 'constructor', 'toString'])(
    'has no timezone for the unknown country code %j',
    (code) => {
      expect(timezonesForCountry(code)).toEqual([])
      expect(defaultTimezoneForCountry(code)).toBeNull()
    },
  )

  it('keeps every generated zone valid, sorted, unique and frozen', () => {
    let zoneCount = 0
    let countryCount = 0
    for (const code of EVERY_TWO_LETTER_CODE) {
      const zones = timezonesForCountry(code)
      if (zones.length === 0) continue
      countryCount += 1
      zoneCount += zones.length
      expect(Object.isFrozen(zones)).toBe(true)
      expect([...zones].sort()).toEqual(zones)
      expect(new Set(zones).size).toBe(zones.length)
      for (const zone of zones) expect(isValidIanaTimezone(zone)).toBe(true)
    }
    // tzdata 2026c zone.tab: 418 rows across 247 countries. A lower count here
    // means the runtime stopped accepting a stored spelling: regenerate the table.
    expect(countryCount).toBe(247)
    expect(zoneCount).toBe(418)
  })
})
