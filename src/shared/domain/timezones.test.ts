import { afterEach, describe, expect, it, vi } from 'vitest'

/** The catalogue module as a runtime that lists these zones would load it. */
async function catalogueListing(zones: readonly string[]) {
  vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue([...zones])
  vi.resetModules()
  return import('./timezones')
}

describe('timezone catalogue', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Safari's runtime lists every Etc/GMT±N fixed offset; Node and Chrome list
  // none. An offset has no daylight saving, and the server never accepts one.
  it('never offers a fixed-offset zone, whatever the runtime lists', async () => {
    const { VALID_TIMEZONES, isValidIanaTimezone } = await catalogueListing([
      'Etc/GMT-3',
      'Etc/GMT+5',
      'Europe/Kyiv',
      'Europe/Sofia',
    ])

    expect(VALID_TIMEZONES).toEqual(['Europe/Kyiv', 'Europe/Sofia', 'UTC'])
    expect(isValidIanaTimezone('Etc/GMT-3')).toBe(false)
  })

  it('accepts a region zone the runtime spells differently from its own list', async () => {
    const { isRegionTimezone } = await catalogueListing(['Asia/Kolkata', 'Europe/Kyiv'])

    expect(isRegionTimezone('Asia/Calcutta')).toBe(true)
    expect(isRegionTimezone('Europe/Kiev')).toBe(true)
    expect(isRegionTimezone('UTC')).toBe(true)
  })

  it.each([
    'Etc/GMT-3',
    '+03:00',
    'EST',
    'US/Eastern',
    'Europe/sofia',
    'Europe/Atlantis',
  ])('refuses a name that is not a region zone: %s', async (timezone) => {
    const { isRegionTimezone } = await catalogueListing(['Europe/Sofia'])

    expect(isRegionTimezone(timezone)).toBe(false)
  })
})
