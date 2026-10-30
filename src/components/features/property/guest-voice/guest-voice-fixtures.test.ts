// The fixtures the stories stand on must be things the read model could produce: every
// figure is the engine's, the ranking is the contract's, and every title on a page opens
// a drawer that agrees with it.
import { describe, expect, it } from 'vitest'
import type {
  GuestVoiceV2Ready,
  LiveEvidence,
} from '#/contexts/ai/application/public-api'
import { drawerForIssue } from './guest-voice-fixtures-drawer-for'
import {
  FACILITIES_DRAWER,
  LONG_REVIEW_DRAWER,
  SMALL_DRAWER,
  URGENT_DRAWER,
} from './guest-voice-fixtures-drawers'
import { LARGE_READ, LARGE_WINDOW } from './guest-voice-fixtures-large'
import { PROVISIONAL_READ, URGENT_READ } from './guest-voice-fixtures-states'
import { SMALL_READ, SMALL_WINDOW } from './guest-voice-fixtures-small'

const READS: readonly (readonly [string, GuestVoiceV2Ready])[] = [
  ['large', LARGE_READ],
  ['urgent', URGENT_READ],
  ['small', SMALL_READ],
  ['provisional', PROVISIONAL_READ],
]

/** What a quote underlines, as text. */
const underlined = (quote: LiveEvidence) =>
  quote.sentenceRanges.map(({ start, end }) => quote.text.slice(start, end))

describe.each(READS)('the %s read', (_name, read) => {
  it('ranks problems the way the contract says: most stars at stake, then most reviews', () => {
    const order = read.fixFirst.map((item) => [
      item.statistics.upTo ?? -1,
      item.statistics.reviewCount,
    ])

    expect(order).toEqual(
      [...order].sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0) || (b[1] ?? 0) - (a[1] ?? 0)),
    )
  })

  it('ranks only problems named in three or more reviews, and watches one or two', () => {
    for (const item of read.fixFirst) {
      expect(item.statistics.reviewCount).toBeGreaterThanOrEqual(3)
    }
    for (const item of read.watch) expect([1, 2]).toContain(item.reviewCount)
  })

  it('says "of" the reviews with text the window holds, in every figure', () => {
    const issues = [...read.urgent, ...read.fixFirst, ...read.guestsLove]
    for (const { statistics } of issues) {
      expect(statistics.textReviewCount).toBe(read.basis.textReviewCount)
      expect(statistics.shareText).toBe(
        `${statistics.reviewCount} of ${statistics.textReviewCount}`,
      )
      expect(statistics.allReviewCount).toBe(
        read.basis.textReviewCount + read.basis.starOnlyCount,
      )
    }
  })

  it('claims a change only where the engine judged one likely', () => {
    for (const item of read.whatChanged) {
      expect(['rising', 'falling']).toContain(item.statistics.change)
      expect(item.statistics.change).toBe(item.change)
      expect(item.statistics.evidenceLevel).toBe('likely')
    }
  })

  it('underlines whole sentences of every quote, and only those', () => {
    const quotes = [...read.urgent, ...read.fixFirst, ...read.guestsLove].flatMap(
      (item) => (item.quote == null ? [] : [item.quote]),
    )

    for (const quote of quotes) {
      const marked = underlined(quote)
      expect(marked.length).toBeGreaterThan(0)
      for (const sentence of marked) expect(sentence).toMatch(/[.!?…]$/u)
    }
  })
})

describe('the hotel', () => {
  it('has the numbers the agreed design shows for its top two problems', () => {
    const [facilities, cleanliness] = LARGE_READ.fixFirst
    expect(facilities?.statistics).toMatchObject({
      shareText: '19 of 128',
      upTo: 0.2,
      change: 'rising',
      evidenceLevel: 'likely',
    })
    expect(facilities?.statistics.mentionedAverage?.toFixed(1)).toBe('2.1')
    expect(facilities?.statistics.othersAverage?.toFixed(1)).toBe('4.3')
    expect(cleanliness?.statistics).toMatchObject({
      shareText: '21 of 128',
      upTo: 0.15,
      change: 'steady',
    })
  })

  it('says the same of a topic in What changed and in Every topic', () => {
    for (const item of LARGE_READ.whatChanged) {
      const row = LARGE_READ.everyTopic.find(
        (candidate) => candidate.topic === item.topic,
      )
      expect(row?.statistics.change, item.title).toBe(item.change)
    }
  })

  it('holds 128 reviews with text and 224 in all', () => {
    expect(LARGE_WINDOW).toMatchObject({ textReviews: 128, allReviews: 224 })
    expect(LARGE_READ.basis).toEqual({ textReviewCount: 128, starOnlyCount: 96 })
  })

  it('reports an Urgent review with its reason and its quote', () => {
    const [railing] = URGENT_READ.urgent
    expect(railing).toMatchObject({ urgentReason: 'safety', topic: 'safety' })
    expect(railing?.quote ? underlined(railing.quote) : []).toEqual([
      'The balcony railing was loose and our kids were with us.',
    ])
  })

  it('claims no change while reviews are still being analysed', () => {
    expect(PROVISIONAL_READ.provisional).toBe(true)
    expect(PROVISIONAL_READ.whatChanged).toEqual([])
    for (const row of PROVISIONAL_READ.everyTopic) {
      expect(row.statistics.change).toBe('unknown')
    }
  })
})

describe('the guesthouse', () => {
  it('has too little history before the year to judge any change', () => {
    expect(SMALL_WINDOW.baselineReviews).toBeLessThan(20)
    for (const row of SMALL_READ.everyTopic) expect(row.statistics.change).toBe('unknown')
    expect(SMALL_READ.whatChanged).toEqual([])
  })

  it('prints a percent only where there are 20 reviews to take it of', () => {
    expect(SMALL_READ.everyTopic[0]?.statistics.sharePercent).toBe(58)
    expect(SMALL_READ.fixFirst[0]?.statistics.upTo).not.toBeNull()
  })
})

describe('the drawers', () => {
  it('count the causes of the issue they open from, and the months of the window', () => {
    const total = (drawer: typeof FACILITIES_DRAWER) =>
      drawer.causes.reduce((sum, cause) => sum + cause.reviewCount, 0)

    expect(total(FACILITIES_DRAWER)).toBe(FACILITIES_DRAWER.statistics.reviewCount)
    const lastThree = FACILITIES_DRAWER.twelveMonthSeries
      .slice(-3)
      .reduce((sum, month) => sum + month.complaintReviews, 0)
    expect(lastThree).toBe(FACILITIES_DRAWER.statistics.reviewCount)
    expect(FACILITIES_DRAWER.twelveMonthSeries).toHaveLength(12)
  })

  it('quote fewer reviews than name the issue where a quote would name a person', () => {
    expect(SMALL_DRAWER.statistics.reviewCount).toBe(5)
    expect(SMALL_DRAWER.liveEvidence).toHaveLength(3)
    expect(URGENT_DRAWER.liveEvidence).toHaveLength(1)
  })

  it('cite a stretch in the middle of a long review', () => {
    const [quote] = LONG_REVIEW_DRAWER.liveEvidence
    expect(quote?.text.length).toBeGreaterThan(500)
    expect(quote ? underlined(quote) : []).toHaveLength(2)
  })

  it.each(READS)('open from every title the %s page shows', (_name, read) => {
    const window = read === SMALL_READ ? SMALL_WINDOW : LARGE_WINDOW
    const issueIds = [
      ...read.urgent,
      ...read.fixFirst,
      ...read.guestsLove,
      ...read.watch,
    ].map((item) => item.issueId)

    for (const issueId of issueIds) {
      const drawer = drawerForIssue(read, issueId, window)
      expect(drawer?.issueId, issueId).toBe(issueId)
      expect(drawer?.twelveMonthSeries).toHaveLength(12)
      const cited = drawer?.causes.reduce((sum, cause) => sum + cause.reviewCount, 0) ?? 0
      expect(cited).toBeLessThanOrEqual(drawer?.statistics.reviewCount ?? 0)
    }
    expect(drawerForIssue(read, 'no-such-issue', window)).toBeUndefined()
  })
})
