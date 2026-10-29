import { describe, expect, it } from 'vitest'
import type {
  ChangedItem,
  IssueStatistics,
  ReviewTopicV3,
} from '#/contexts/ai/application/public-api'
import {
  averagesSpoken,
  averagesText,
  changePill,
  changeSentence,
  inReviewsText,
  monthLabel,
  reviewDay,
  reviewsPhrase,
  splitLead,
  topicLabel,
  urgentReasonWords,
  windowDates,
  windowSentence,
  worthUpToText,
} from './guest-voice-words'

const STATISTICS: IssueStatistics = {
  reviewCount: 19,
  textReviewCount: 128,
  allReviewCount: 224,
  shareText: '19 of 128',
  sharePercent: 15,
  mentionedAverage: 2.1,
  othersAverage: 4.3,
  gap: 2.2,
  upTo: 0.2,
  change: 'rising',
  evidenceLevel: 'likely',
}

const TOPICS: readonly ReviewTopicV3[] = [
  'staff_service',
  'speed_waiting',
  'booking_arrival',
  'main_service',
  'food_drink',
  'cleanliness',
  'facilities_equipment',
  'price_billing',
  'atmosphere_noise',
  'location_access',
  'safety',
  'communication',
]

describe('topic and reason words', () => {
  it('labels each of the twelve topics once, in sentence case', () => {
    const labels = TOPICS.map(topicLabel)

    expect(new Set(labels).size).toBe(12)
    expect(labels).toContain('Facilities and equipment')
    expect(labels).toContain('The main service')
    for (const label of labels) expect(label).toMatch(/^[A-Z][^A-Z]*$/u)
  })

  it('words the four urgent reasons', () => {
    expect(urgentReasonWords('safety')).toBe('safety')
    expect(urgentReasonWords('legal_threat')).toBe('legal threat')
  })
})

describe('counts and averages', () => {
  it('counts a review in the singular and groups thousands', () => {
    expect(reviewsPhrase(1)).toBe('1 review')
    expect(reviewsPhrase(0)).toBe('0 reviews')
    expect(reviewsPhrase(1234)).toBe('1,234 reviews')
  })

  it('says how many of the reviews with text name it', () => {
    expect(inReviewsText(STATISTICS)).toBe('in 19 of 128 reviews')
  })

  it('prints the averages of the reviews that name it and of the rest', () => {
    expect(averagesText(STATISTICS)).toBe('those average 2.1★, the rest 4.3★')
    expect(averagesSpoken(STATISTICS)).toBe(
      'Those reviews gave 2.1 stars on average, the rest 4.3 stars',
    )
  })

  it('prints the one average it has when the rest are unknown, and none when it has none', () => {
    const only = { ...STATISTICS, othersAverage: null }
    expect(averagesText(only)).toBe('average 2.1★')
    expect(averagesSpoken(only)).toBe('Those reviews gave 2.1 stars on average')
    const none = { ...STATISTICS, mentionedAverage: null, othersAverage: null }
    expect(averagesText(none)).toBeNull()
    expect(averagesSpoken(none)).toBeNull()
  })
})

describe('worth up to', () => {
  it('names the stars at stake on the window the average is over', () => {
    expect(worthUpToText(STATISTICS, '90d')).toBe(
      'worth up to about 0.2★ on your 90-day average',
    )
    expect(worthUpToText({ ...STATISTICS, upTo: 0.15 }, '30d')).toBe(
      'worth up to about 0.15★ on your 30-day average',
    )
    expect(worthUpToText({ ...STATISTICS, upTo: 0.05 }, '180d')).toBe(
      'worth up to about 0.05★ on your 6-month average',
    )
    expect(worthUpToText({ ...STATISTICS, upTo: 1 }, '365d')).toBe(
      'worth up to about 1.0★ on your 12-month average',
    )
  })

  it('says nothing where the engine has no figure or the figure is nothing', () => {
    expect(worthUpToText({ ...STATISTICS, upTo: null }, '90d')).toBeNull()
    expect(worthUpToText({ ...STATISTICS, upTo: 0 }, '90d')).toBeNull()
  })
})

describe('changePill', () => {
  it('colours a rising complaint as bad news and a falling one as good', () => {
    expect(changePill('rising', 'likely', 'complaint')).toEqual({
      label: 'Rising, likely real',
      tone: 'negative',
      direction: 'up',
    })
    expect(changePill('falling', 'likely', 'complaint')).toEqual({
      label: 'Falling, likely real',
      tone: 'positive',
      direction: 'down',
    })
  })

  it('colours rising praise as good news and falling praise as a worry, not a failure', () => {
    expect(changePill('rising', 'likely', 'praise')?.tone).toBe('positive')
    expect(changePill('falling', 'likely', 'praise')?.tone).toBe('warn')
  })

  it('calls a move "likely real" only on the evidence level that says so', () => {
    expect(changePill('rising', 'early', 'complaint')?.label).toBe('Rising, early signal')
    expect(changePill('falling', 'not_enough', 'praise')?.label).toBe(
      'Falling, early signal',
    )
  })

  it('shows steady quietly and nothing where the engine could not judge', () => {
    expect(changePill('steady', 'early', 'complaint')).toEqual({
      label: 'Steady',
      tone: 'neutral',
      direction: 'flat',
    })
    expect(changePill('unknown', 'early', 'complaint')).toBeNull()
  })
})

describe('changeSentence', () => {
  const item: ChangedItem = {
    issueId: 'issue-1',
    title: 'Facilities and equipment',
    topic: 'facilities_equipment',
    change: 'rising',
    evidenceLevel: 'likely',
    statistics: STATISTICS,
    polarity: 'complaint',
  }

  it('says which way the share of reviews went against the 12 months before', () => {
    expect(changeSentence(item)).toBe(
      '19 of 128 reviews complain about it, more often than in the 12 months before.',
    )
    expect(
      changeSentence({
        ...item,
        change: 'falling',
        polarity: 'praise',
        statistics: { ...STATISTICS, shareText: '40 of 128' },
      }),
    ).toBe('40 of 128 reviews praise it, less often than in the 12 months before.')
  })

  it('says a problem has gone quiet when no review names it now', () => {
    const quiet = { ...item, change: 'falling' as const }
    expect(
      changeSentence({ ...quiet, statistics: { ...STATISTICS, reviewCount: 0 } }),
    ).toBe('No review complains about it now.')
    expect(
      changeSentence({
        ...quiet,
        polarity: 'praise',
        statistics: { ...STATISTICS, reviewCount: 0 },
      }),
    ).toBe('No review praises it now.')
  })
})

describe('windowSentence', () => {
  const base = {
    range: 'auto',
    window: '90d',
    textReviewCount: 128,
    starOnlyCount: 96,
  } as const

  it('names an automatic window and why it was chosen', () => {
    expect(windowSentence(base)).toBe(
      'Last 90 days, chosen because it holds 128 reviews with text (plus 96 without text).',
    )
  })

  it('leaves out the reviews without text when there are none', () => {
    expect(windowSentence({ ...base, starOnlyCount: 0 })).toBe(
      'Last 90 days, chosen because it holds 128 reviews with text.',
    )
  })

  it('says why the automatic window is the whole year when no shorter one holds enough', () => {
    expect(
      windowSentence({ ...base, window: '365d', textReviewCount: 36, starOnlyCount: 14 }),
    ).toBe(
      'Last 12 months, chosen because no shorter period holds enough reviews with text. It holds 36 reviews with text (plus 14 without text).',
    )
  })

  it('is plain "chosen because" when the year itself holds enough', () => {
    expect(
      windowSentence({ ...base, window: '365d', textReviewCount: 80, starOnlyCount: 0 }),
    ).toBe('Last 12 months, chosen because it holds 80 reviews with text.')
  })

  it('does not claim to have chosen a window the person chose', () => {
    expect(
      windowSentence({ ...base, range: '30d', window: '30d', textReviewCount: 40 }),
    ).toBe('Last 30 days. It holds 40 reviews with text (plus 96 without text).')
  })

  it('warns that a window the person chose can hold too few reviews to spot patterns', () => {
    expect(
      windowSentence({
        range: '30d',
        window: '30d',
        textReviewCount: 4,
        starOnlyCount: 0,
      }),
    ).toBe(
      'Last 30 days. It holds 4 reviews with text. That is too few to spot patterns.',
    )
    expect(
      windowSentence({
        range: '30d',
        window: '30d',
        textReviewCount: 0,
        starOnlyCount: 0,
      }),
    ).toBe(
      'Last 30 days. It holds no reviews with text. That is too few to spot patterns.',
    )
  })
})

describe('dates', () => {
  it('prints the days the window covers', () => {
    expect(windowDates('2026-07-31', '2026-10-29')).toBe('Jul 31 to Oct 29, 2026')
    expect(windowDates('bad', '2026-10-29')).toBeNull()
  })

  it('prints the day of a review given as a day or as an instant', () => {
    expect(reviewDay('2026-10-18')).toBe('Oct 18, 2026')
    expect(reviewDay('2026-10-18T21:30:00.000Z')).toBe('Oct 18, 2026')
    expect(reviewDay('not a date')).toBeNull()
  })

  it('names a series month for a bar and for a sentence', () => {
    expect(monthLabel('2026-10')).toEqual({ short: 'Oct', long: 'October 2026' })
    expect(monthLabel('2025-01')).toEqual({ short: 'Jan', long: 'January 2025' })
  })
})

describe('splitLead', () => {
  it('splits a template line at its first colon', () => {
    expect(
      splitLead(
        'Facilities and equipment is the top problem: 19 of 128 reviews, mostly air conditioning.',
      ),
    ).toEqual({
      lead: 'Facilities and equipment is the top problem',
      rest: ' 19 of 128 reviews, mostly air conditioning.',
    })
    expect(splitLead('New: unexpected charges, 3 reviews since Oct 9.')).toEqual({
      lead: 'New',
      rest: ' unexpected charges, 3 reviews since Oct 9.',
    })
  })

  it('leaves a line with no colon, or a colon far into it, whole', () => {
    expect(splitLead('Guests love your staff.')).toEqual({
      lead: null,
      rest: 'Guests love your staff.',
    })
    const late = `${'word '.repeat(20)}end: here`
    expect(splitLead(late).lead).toBeNull()
  })
})
