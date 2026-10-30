import { describe, expect, it } from 'vitest'
import { GUEST_VOICE_STATISTICS_VERSION } from '../../domain/guest-voice-statistics'
import type { GuestVoiceV2Ready } from './guest-voice-v2'
import type { GuestVoiceReview } from './guest-voice-v2-facts'
import {
  hasUrgentReviewThisWeek,
  isFirstMondayOfMonth,
  isMonday,
  isoWeekday,
  isQuietWeek,
  isSummaryMorning,
  summaryLines,
} from './guest-voice-v2-summary'

const STATS = {
  reviewCount: 19,
  textReviewCount: 128,
  allReviewCount: 224,
  shareText: '19 of 128',
  sharePercent: null,
  mentionedAverage: 2.1,
  othersAverage: 4.3,
  gap: 2.2,
  upTo: 0.2,
  change: 'rising',
  evidenceLevel: 'likely',
} as const

function read(over: Partial<GuestVoiceV2Ready> = {}): GuestVoiceV2Ready {
  return {
    status: 'ready',
    readModelVersion: 'guest-voice-read-v2',
    statisticsVersion: GUEST_VOICE_STATISTICS_VERSION,
    window: '90d',
    startLocalDate: '2026-08-12',
    endLocalDate: '2026-11-09',
    dataThroughLocalDate: '2026-11-09',
    provisional: false,
    basis: { textReviewCount: 128, starOnlyCount: 96 },
    inShort: [],
    urgent: [],
    fixFirst: [],
    guestsLove: [],
    staffPraise: null,
    watch: [],
    whatChanged: [],
    everyTopic: [],
    ...over,
  }
}

const issue = (issueId: string, topic: 'cleanliness' | 'staff_service' = 'cleanliness') =>
  ({
    issueId,
    title: `Title of ${issueId}`,
    topic,
    causes: [],
    urgentReason: null,
    statistics: STATS,
  }) as const

describe('the Monday calendar', () => {
  it('numbers the weekday from Monday 1 to Sunday 7', () => {
    expect(
      ['2026-11-09', '2026-11-10', '2026-11-14', '2026-11-15'].map(isoWeekday),
    ).toEqual([1, 2, 6, 7])
  })

  it('knows a Monday, across a month and a year end', () => {
    expect(isMonday('2026-11-09')).toBe(true)
    expect(isMonday('2026-11-10')).toBe(false)
    expect(isMonday('2024-12-30')).toBe(true)
    expect(isMonday('2029-01-01')).toBe(true)
  })

  it('names the first Monday of a month: a Monday on the 1st to the 7th', () => {
    expect(isFirstMondayOfMonth('2026-11-02')).toBe(true)
    expect(isFirstMondayOfMonth('2026-12-07')).toBe(true)
    expect(isFirstMondayOfMonth('2026-11-09')).toBe(false)
    expect(isFirstMondayOfMonth('2026-10-26')).toBe(false)
    // The 7th that is not a Monday, and the 8th that is.
    expect(isFirstMondayOfMonth('2026-11-07')).toBe(false)
    expect(isFirstMondayOfMonth('2026-06-08')).toBe(false)
    expect(isFirstMondayOfMonth('2026-06-01')).toBe(true)
  })

  it('has exactly one first Monday in every month of several years', () => {
    for (let year = 2026; year <= 2030; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const firstMondays = Array.from({ length: 31 }, (_, index) => index + 1)
          .map(
            (day) =>
              `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          )
          .filter((date) => !Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
          .filter((date) => new Date(`${date}T00:00:00Z`).getUTCMonth() + 1 === month)
          .filter(isFirstMondayOfMonth)
        expect(firstMondays, `${year}-${month}`).toHaveLength(1)
      }
    }
  })
})

describe('a Property’s Monday morning', () => {
  it('is 08:00 to 10:59 on a Monday on the Property’s own clock', () => {
    // Monday 2026-11-09 in New York is UTC-5.
    const at = (hour: number, minute = 0, day = 9) =>
      Date.UTC(2026, 10, day, hour + 5, minute)
    expect(isSummaryMorning(at(7, 59), 'America/New_York')).toBe(false)
    expect(isSummaryMorning(at(8), 'America/New_York')).toBe(true)
    expect(isSummaryMorning(at(10, 59), 'America/New_York')).toBe(true)
    expect(isSummaryMorning(at(11), 'America/New_York')).toBe(false)
    // The same instants on Tuesday are not.
    expect(isSummaryMorning(at(9, 0, 10), 'America/New_York')).toBe(false)
  })

  it('follows the Property’s zone, not the server’s: Sofia is a day ahead of Honolulu', () => {
    const instant = Date.UTC(2026, 10, 9, 7, 0) // Monday 09:00 in Sofia (UTC+2)
    expect(isSummaryMorning(instant, 'Europe/Sofia')).toBe(true)
    expect(isSummaryMorning(instant, 'Pacific/Honolulu')).toBe(false)
    // Sunday evening in Honolulu, Monday morning in Auckland.
    const auckland = Date.UTC(2026, 10, 8, 20, 30) // Monday 09:30 in Auckland (UTC+13)
    expect(isSummaryMorning(auckland, 'Pacific/Auckland')).toBe(true)
  })

  it('finds a half-hour zone’s morning', () => {
    // 03:30 UTC is 09:00 in Kolkata (UTC+5:30).
    expect(isSummaryMorning(Date.UTC(2026, 10, 9, 3, 30), 'Asia/Kolkata')).toBe(true)
    expect(isSummaryMorning(Date.UTC(2026, 10, 9, 2, 29), 'Asia/Kolkata')).toBe(false)
  })

  it('holds across a daylight-saving change', () => {
    // The clocks in New York went back on Sunday 2026-11-01: Monday 08:00 is 13:00 UTC.
    expect(isSummaryMorning(Date.UTC(2026, 10, 2, 13, 0), 'America/New_York')).toBe(true)
    expect(isSummaryMorning(Date.UTC(2026, 10, 2, 12, 59), 'America/New_York')).toBe(
      false,
    )
    // In March they went forward: Monday 08:00 is 12:00 UTC.
    expect(isSummaryMorning(Date.UTC(2026, 2, 9, 12, 0), 'America/New_York')).toBe(true)
  })

  it('is never a morning in a zone this runtime does not know', () => {
    expect(isSummaryMorning(Date.UTC(2026, 10, 9, 8, 0), 'Mars/Olympus_Mons')).toBe(false)
  })
})

describe('the three lines', () => {
  it('states fix first, protect and change as topics and counts, and nothing a guest wrote', () => {
    const lines = summaryLines(
      read({
        fixFirst: [issue('a'), issue('b')],
        guestsLove: [
          {
            issueId: 'c',
            title: 'Friendly staff',
            topic: 'staff_service',
            statistics: STATS,
          },
        ],
        whatChanged: [
          {
            issueId: 'd',
            title: 'Dirty rooms',
            topic: 'cleanliness',
            change: 'falling',
            evidenceLevel: 'likely',
            statistics: STATS,
            polarity: 'complaint',
          },
        ],
      }),
    )

    expect(lines).toEqual([
      {
        kind: 'fix_first',
        topic: 'cleanliness',
        issueId: 'a',
        reviewCount: 19,
        textReviewCount: 128,
        upTo: 0.2,
        change: null,
        polarity: null,
      },
      {
        kind: 'protect',
        topic: 'staff_service',
        issueId: 'c',
        reviewCount: 19,
        textReviewCount: 128,
        upTo: null,
        change: null,
        polarity: null,
      },
      {
        kind: 'change',
        topic: 'cleanliness',
        issueId: 'd',
        reviewCount: 19,
        textReviewCount: 128,
        upTo: null,
        change: 'falling',
        polarity: 'complaint',
      },
    ])
    expect(JSON.stringify(lines)).not.toMatch(/Title of|Friendly|Dirty/)
  })

  it('has as many lines as the page has, and none for a page with nothing to say', () => {
    expect(summaryLines(read())).toEqual([])
    expect(summaryLines(read({ fixFirst: [issue('a')] }))).toHaveLength(1)
  })
})

describe('a quiet week', () => {
  const now = read({ fixFirst: [issue('a'), issue('b')], watch: [] })

  it('is one where Fix first held, nothing is new and no review was Urgent', () => {
    expect(
      isQuietWeek({
        now,
        before: read({ fixFirst: [issue('a'), issue('b')] }),
        urgentThisWeek: false,
      }),
    ).toBe(true)
  })

  it('is not one when Fix first reordered', () => {
    expect(
      isQuietWeek({
        now,
        before: read({ fixFirst: [issue('b'), issue('a')] }),
        urgentThisWeek: false,
      }),
    ).toBe(false)
  })

  it('is not one when an issue entered Fix first', () => {
    expect(
      isQuietWeek({
        now,
        before: read({ fixFirst: [issue('a')] }),
        urgentThisWeek: false,
      }),
    ).toBe(false)
  })

  it('is not one when an issue left Fix first', () => {
    expect(
      isQuietWeek({
        now: read({ fixFirst: [issue('a')] }),
        before: read({ fixFirst: [issue('a'), issue('b')] }),
        urgentThisWeek: false,
      }),
    ).toBe(false)
  })

  it('is not one when an issue is new to Watch', () => {
    const watching = (id: string) => ({
      issueId: id,
      title: id,
      topic: 'cleanliness' as const,
      reviewCount: 1 as const,
    })
    expect(
      isQuietWeek({
        now: read({ fixFirst: [issue('a')], watch: [watching('w')] }),
        before: read({ fixFirst: [issue('a')] }),
        urgentThisWeek: false,
      }),
    ).toBe(false)
  })

  it('is one when a watched issue is simply still watched, or moved up to Fix first from Watch', () => {
    const watching = (id: string) => ({
      issueId: id,
      title: id,
      topic: 'cleanliness' as const,
      reviewCount: 2 as const,
    })
    expect(
      isQuietWeek({
        now: read({ watch: [watching('w')] }),
        before: read({ watch: [watching('w')] }),
        urgentThisWeek: false,
      }),
    ).toBe(true)
  })

  it('is never one when a review was Urgent', () => {
    expect(isQuietWeek({ now, before: now, urgentThisWeek: true })).toBe(false)
  })

  it('is never one when there is nothing to compare with', () => {
    expect(isQuietWeek({ now, before: null, urgentThisWeek: false })).toBe(false)
  })

  it('is one for a Property whose page is empty both weeks', () => {
    expect(isQuietWeek({ now: read(), before: read(), urgentThisWeek: false })).toBe(true)
  })
})

describe('an Urgent review this week', () => {
  const review = (localDate: string, urgentReason: GuestVoiceReview['urgentReason']) =>
    ({
      reviewId: `r-${localDate}`,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      localDate,
      rating: 1,
      urgentReason,
      mentions: [],
    }) satisfies GuestVoiceReview

  it('is one left after the same weekday last week, up to today', () => {
    expect(hasUrgentReviewThisWeek([review('2026-11-03', 'safety')], '2026-11-09')).toBe(
      true,
    )
    expect(hasUrgentReviewThisWeek([review('2026-11-09', 'health')], '2026-11-09')).toBe(
      true,
    )
  })

  it('is not one from last Monday or earlier', () => {
    expect(hasUrgentReviewThisWeek([review('2026-11-02', 'safety')], '2026-11-09')).toBe(
      false,
    )
    expect(
      hasUrgentReviewThisWeek([review('2026-10-01', 'legal_threat')], '2026-11-09'),
    ).toBe(false)
  })

  it('is not a review that was not Urgent', () => {
    expect(hasUrgentReviewThisWeek([review('2026-11-08', null)], '2026-11-09')).toBe(
      false,
    )
  })
})
