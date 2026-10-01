import { afterEach, describe, expect, it } from 'vitest'
import { GUEST_LOCALES, guestLocaleFormatTag } from '#/shared/domain/guest-locale'
import { describeGuestDeadline, formatGuestDeadline } from './guest-deadline-format'
import { bgV2 } from './language-packs/bg-v2'
import { deV2 } from './language-packs/de-v2'
import { enV2 } from './language-packs/en-v2'
import { esV2 } from './language-packs/es-v2'
import { frV2 } from './language-packs/fr-v2'
import { itV2 } from './language-packs/it-v2'

// 12:32 UTC = 15:32 in Sofia (UTC+3 in summer), 14:32 in Europe/Berlin.
const NOW = '2026-09-30T09:00:00.000Z'
describe('describeGuestDeadline', () => {
  it('says today for a deadline on the same calendar day in the portal zone', () => {
    expect(
      describeGuestDeadline('2026-09-30T12:32:00.000Z', NOW, 'Europe/Sofia'),
    ).toEqual({
      when: 'today',
      time: '15:32',
      zone: 'Sofia',
    })
  })

  it('says tomorrow for the next calendar day in the portal zone', () => {
    expect(
      describeGuestDeadline('2026-10-01T11:32:00.000Z', NOW, 'Europe/Sofia'),
    ).toMatchObject({
      when: 'tomorrow',
      time: '14:32',
    })
  })

  it('decides today and tomorrow in the portal zone, not in UTC', () => {
    // 22:30 UTC on the 30th is already 01:30 on the 1st in Sofia.
    const late = describeGuestDeadline('2026-09-30T22:30:00.000Z', NOW, 'Europe/Sofia')
    expect(late).toMatchObject({ when: 'tomorrow', time: '01:30' })
    // ...and still the 30th in Lisbon (UTC+1 in summer).
    expect(
      describeGuestDeadline('2026-09-30T22:30:00.000Z', NOW, 'Europe/Lisbon'),
    ).toMatchObject({
      when: 'today',
      time: '23:30',
    })
  })

  it('names a later day by its date', () => {
    const later = describeGuestDeadline('2026-10-04T09:05:00.000Z', NOW, 'Europe/Sofia')
    expect(later.when).toBe('date')
    expect(later).toMatchObject({ time: '12:05', zone: 'Sofia' })
  })

  it('writes midnight as 00:00, never 24:00', () => {
    expect(
      describeGuestDeadline('2026-09-30T21:00:00.000Z', NOW, 'Europe/Sofia'),
    ).toMatchObject({
      time: '00:00',
      when: 'tomorrow',
    })
  })

  it('turns a multi-word zone id into a readable place name', () => {
    expect(
      describeGuestDeadline('2026-09-30T12:00:00.000Z', NOW, 'America/Los_Angeles').zone,
    ).toBe('Los Angeles')
    expect(describeGuestDeadline('2026-09-30T12:00:00.000Z', NOW, 'UTC').zone).toBe('UTC')
  })

  it('labels a fixed-offset zone by its real UTC offset, not by its inverted GMT name', () => {
    const zone = (id: string) =>
      describeGuestDeadline('2026-09-30T12:00:00.000Z', NOW, id).zone
    expect(zone('Etc/GMT-3')).toBe('UTC+3')
    expect(zone('Etc/GMT+5')).toBe('UTC-5')
    expect(zone('Etc/GMT')).toBe('UTC')
    expect(zone('Etc/UTC')).toBe('UTC')
  })

  it('rejects an invalid instant or zone instead of printing garbage', () => {
    expect(() => describeGuestDeadline('not a date', NOW, 'Europe/Sofia')).toThrow(
      'Invalid deadline instant: not a date',
    )
    expect(() => describeGuestDeadline(NOW, NOW, 'Mars/Olympus')).toThrow(RangeError)
  })
})

describe('formatGuestDeadline', () => {
  const at = (pack: typeof enV2, deadline: string, zone: string, tag: string): string =>
    formatGuestDeadline(pack, deadline, NOW, zone, tag)

  it('fills the today, tomorrow and date templates in English', () => {
    expect(at(enV2, '2026-09-30T12:32:00.000Z', 'Europe/Sofia', 'en')).toBe(
      'Until 15:32 today, Sofia time',
    )
    expect(at(enV2, '2026-10-01T11:32:00.000Z', 'Europe/Sofia', 'en')).toBe(
      'Until 14:32 tomorrow, Sofia time',
    )
    expect(at(enV2, '2026-10-04T09:05:00.000Z', 'Europe/Sofia', 'en')).toBe(
      'Until Oct 4, 2026, 12:05, Sofia time',
    )
  })

  it('fills the templates of the Bulgarian pack, zone name and all', () => {
    expect(at(bgV2, '2026-09-30T12:32:00.000Z', 'Europe/Sofia', 'bg-BG')).toBe(
      'До 15:32 днес, местно време в София',
    )
    expect(at(bgV2, '2026-10-01T11:32:00.000Z', 'Europe/Sofia', 'bg-BG')).toBe(
      'До 14:32 утре, местно време в София',
    )
    expect(at(bgV2, '2026-10-04T09:05:00.000Z', 'Europe/Sofia', 'bg-BG')).toBe(
      'До 4.10.2026 г., 12:05, местно време в София',
    )
  })

  // 12:32 UTC is 15:32 in Sofia; the date of a later day comes from the engine
  // in the pack's own tag, the rest from the pack's templates.
  it.each([
    [
      'es',
      esV2,
      [
        'Hasta hoy a las 15:32, hora de Sofía',
        'Hasta mañana a las 14:32, hora de Sofía',
        'Hasta el 4 oct 2026, 12:05, hora de Sofía',
      ],
    ],
    [
      'it',
      itV2,
      [
        'Fino alle 15:32 di oggi, ora di Sofia',
        'Fino alle 14:32 di domani, ora di Sofia',
        'Fino al 4 ott 2026, ore 12:05, ora di Sofia',
      ],
    ],
    [
      'fr',
      frV2,
      [
        'Jusqu’à 15:32 aujourd’hui, heure locale (Sofia)',
        'Jusqu’à 14:32 demain, heure locale (Sofia)',
        'Jusqu’au 4 oct. 2026, 12:05, heure locale (Sofia)',
      ],
    ],
    [
      'de',
      deV2,
      [
        'Bis heute, 15:32 Uhr, Ortszeit Sofia',
        'Bis morgen, 14:32 Uhr, Ortszeit Sofia',
        'Bis 04.10.2026, 12:05 Uhr, Ortszeit Sofia',
      ],
    ],
  ] as const)(
    'fills the templates of the %s pack, zone name and all',
    (locale, pack, lines) => {
      const tag = guestLocaleFormatTag(locale)
      expect([
        at(pack, '2026-09-30T12:32:00.000Z', 'Europe/Sofia', tag),
        at(pack, '2026-10-01T11:32:00.000Z', 'Europe/Sofia', tag),
        at(pack, '2026-10-04T09:05:00.000Z', 'Europe/Sofia', tag),
      ]).toEqual(lines)
    },
  )

  it('names a zone that starts with a vowel in brackets in French, so no elision is needed', () => {
    expect(at(frV2, '2026-09-30T12:32:00.000Z', 'Europe/Athens', 'fr')).toBe(
      'Jusqu’à 15:32 aujourd’hui, heure locale (Athènes)',
    )
    expect(at(frV2, '2026-09-30T12:32:00.000Z', 'Europe/Istanbul', 'fr')).toBe(
      'Jusqu’à 15:32 aujourd’hui, heure locale (Istanbul)',
    )
  })

  it('falls back to the place name of the zone id when the pack has no name for it', () => {
    expect(bgV2.zoneNames['America/Los_Angeles']).toBeUndefined()
    expect(at(bgV2, '2026-09-30T12:00:00.000Z', 'America/Los_Angeles', 'bg-BG')).toBe(
      'До 05:00 днес, местно време в Los Angeles',
    )
  })

  describe('React #418: the server and the browser must print the same text', () => {
    const originalTimeZone = process.env.TZ
    afterEach(() => {
      if (originalTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimeZone
    })

    it.each(GUEST_LOCALES)('is identical in every runtime zone for %s', (locale) => {
      const render = () =>
        at(enV2, '2026-10-04T09:05:00.000Z', 'Europe/Sofia', guestLocaleFormatTag(locale))
      const results = [
        'UTC',
        'America/Los_Angeles',
        'Asia/Tokyo',
        'Pacific/Kiritimati',
      ].map((zone) => {
        process.env.TZ = zone
        return render()
      })
      expect(new Set(results).size).toBe(1)
    })

    it.each(GUEST_LOCALES)('joins date and time with our own glue for %s', (locale) => {
      const tag = guestLocaleFormatTag(locale)
      const text = at(enV2, '2026-10-04T09:05:00.000Z', 'Europe/Sofia', tag)
      // WebKit would write "Oct 4, 2026 at 12:05" from one date-time call; the
      // engine only writes the date here and the pack's template adds the rest.
      const date = new Intl.DateTimeFormat(tag, {
        dateStyle: 'medium',
        timeZone: 'Europe/Sofia',
      }).format(new Date('2026-10-04T09:05:00.000Z'))
      expect(text).toBe(`Until ${date}, 12:05, Sofia time`)
    })
  })
})
