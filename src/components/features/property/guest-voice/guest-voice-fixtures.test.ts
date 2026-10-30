import { describe, expect, it } from 'vitest'
import {
  CHECK_IN_INPUT,
  CHECK_IN_RENAMED_INPUT,
  CHECK_IN_RENAMED,
  HAMPTON_READ,
  CHECK_IN_SMALL_CONCERN,
  CHECK_IN_STEADY,
  CHECK_IN_SLIPPING,
  CHECK_IN_PROVISIONAL,
  checkInDetail,
} from './guest-voice-fixtures-check-in'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
describe('dated check-in fixtures', () => {
  it('uses a coherent raw rating population including both partial edge months', () => {
    expect(HAMPTON_READ.basis.textReviewCount).toBe(CHECK_IN_INPUT.current.length)
    expect(
      HAMPTON_READ.ratingTrend.before.reviewCount +
        HAMPTON_READ.ratingTrend.recent.reviewCount,
    ).toBe(132)
    expect(HAMPTON_READ.ratingTrend.months).toHaveLength(13)
    expect(HAMPTON_READ.ratingTrend.months.at(-1)).toMatchObject({
      partialEnd: true,
      reviewCount: 1,
    })
    expect(HAMPTON_READ.ratingTrend.verdict).toBe('improving')
    expect(CHECK_IN_STEADY.ratingTrend.verdict).toBe('steady')
    expect(CHECK_IN_SLIPPING.ratingTrend.verdict).toBe('slipping')
    expect(CHECK_IN_PROVISIONAL.ratingTrend.verdict).toBe('not_enough')
  })
  it('distinguishes serious groups from reports and never invents small patterns', () => {
    expect(HAMPTON_READ.seriousConcerns).toMatchObject({ groupCount: 2, reviewCount: 5 })
    expect(CHECK_IN_SMALL_CONCERN.latestReviews).toHaveLength(3)
    expect(CHECK_IN_SMALL_CONCERN.status).toBe('not_enough_reviews')
    expect(HAMPTON_READ.everyTopic.map((row) => row.topic).sort()).toEqual(
      [...REVIEW_TOPICS_V3].sort(),
    )
    expect(HAMPTON_READ.guestsLove.length).toBeGreaterThanOrEqual(4)
    expect(HAMPTON_READ.watch.length).toBeGreaterThan(0)
  })
  it('keeps a long manager rename consistent between its page row and sheet', () => {
    const item = CHECK_IN_RENAMED.fixFirst.find((item) =>
      item.title.startsWith('The guest rooms'),
    )
    if (!item) throw new Error('Renamed fixture needs its issue')
    const read = checkInDetail(
      { kind: 'issue', issueId: item.issueId, sense: 'complaint' },
      CHECK_IN_RENAMED_INPUT,
    )
    expect(
      read.status === 'ready' && read.drawer.kind === 'issue' && read.drawer.title,
    ).toBe(item.title)
  })
  it('every page issue resolves to a consistent production-built detail with the right sense', () => {
    for (const [items, sense] of [
      [HAMPTON_READ.fixFirst, 'complaint'],
      [HAMPTON_READ.guestsLove, 'praise'],
    ] as const) {
      for (const item of items) {
        const read = checkInDetail({ kind: 'issue', issueId: item.issueId, sense })
        if (read.status !== 'ready' || read.drawer.kind !== 'issue')
          throw new Error('Fixture must resolve')
        expect(read.drawer.title).toBe(item.title)
        expect(read.drawer.statistics.reviewCount).toBe(item.statistics.reviewCount)
        const series = read.drawer.twelveMonthSeries
        const first = series.at(0)?.startLocalDate ?? ''
        const last = series.at(-1)?.endLocalDate ?? ''
        const expected = CHECK_IN_INPUT.current.filter(
          (r) =>
            r.localDate >= first &&
            r.localDate <= last &&
            r.mentions.some(
              (m) =>
                m.issueGroupId === item.issueId &&
                m.polarity === (sense === 'praise' ? 'positive' : 'negative'),
            ),
        ).length
        expect(series.reduce((n, m) => n + m.reviewCount, 0)).toBe(expected)
      }
    }
    expect(
      checkInDetail({ kind: 'issue', issueId: 'missing', sense: 'complaint' }),
    ).toEqual({ status: 'not_found' })
  })
})
