import { afterEach, describe, expect, it } from 'vitest'
import { GUEST_LOCALES, guestLocaleFormatTag } from '#/shared/domain/guest-locale'
import { describeGuestDeadline, formatGuestDeadline } from './guest-deadline-format'

// 12:32 UTC = 15:32 in Sofia (UTC+3 in summer), 14:32 in Europe/Berlin.
const NOW = '2026-09-30T09:00:00.000Z'
const TEMPLATES = {
  deadlineToday: 'Until {time} today, {zone} time',
  deadlineTomorrow: 'Until {time} tomorrow, {zone} time',
  deadlineDate: 'Until {date}, {time}, {zone} time',
} as const

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

  it('rejects an invalid instant or zone instead of printing garbage', () => {
    expect(() => describeGuestDeadline('not a date', NOW, 'Europe/Sofia')).toThrow(
      'Invalid deadline instant: not a date',
    )
    expect(() => describeGuestDeadline(NOW, NOW, 'Mars/Olympus')).toThrow(RangeError)
  })
})

describe('formatGuestDeadline', () => {
  it('fills the today, tomorrow and date templates', () => {
    expect(
      formatGuestDeadline(
        TEMPLATES,
        '2026-09-30T12:32:00.000Z',
        NOW,
        'Europe/Sofia',
        'en',
      ),
    ).toBe('Until 15:32 today, Sofia time')
    expect(
      formatGuestDeadline(
        TEMPLATES,
        '2026-10-01T11:32:00.000Z',
        NOW,
        'Europe/Sofia',
        'en',
      ),
    ).toBe('Until 14:32 tomorrow, Sofia time')
    expect(
      formatGuestDeadline(
        TEMPLATES,
        '2026-10-04T09:05:00.000Z',
        NOW,
        'Europe/Sofia',
        'en',
      ),
    ).toBe('Until Oct 4, 2026, 12:05, Sofia time')
  })

  describe('React #418: the server and the browser must print the same text', () => {
    const originalTimeZone = process.env.TZ
    afterEach(() => {
      if (originalTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimeZone
    })

    it.each(GUEST_LOCALES)('is identical in every runtime zone for %s', (locale) => {
      const render = () =>
        formatGuestDeadline(
          TEMPLATES,
          '2026-10-04T09:05:00.000Z',
          NOW,
          'Europe/Sofia',
          guestLocaleFormatTag(locale),
        )
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
      const text = formatGuestDeadline(
        TEMPLATES,
        '2026-10-04T09:05:00.000Z',
        NOW,
        'Europe/Sofia',
        guestLocaleFormatTag(locale),
      )
      // WebKit would write "Oct 4, 2026 at 12:05"; the glue comes from the pack.
      expect(text).not.toMatch(/\bat\b|\bum\b|\bà\b|\ba las\b|\balle\b|\bв\b/)
      expect(text).toContain('12:05')
    })

    it('prints the date in the locale of the pack', () => {
      const bg = formatGuestDeadline(
        { ...TEMPLATES, deadlineDate: 'До {date}, {time}, {zone}' },
        '2026-10-04T09:05:00.000Z',
        NOW,
        'Europe/Sofia',
        'bg-BG',
      )
      expect(bg).toMatch(/^До 4\.10\.2026 г\., 12:05, Sofia$/)
    })
  })
})
