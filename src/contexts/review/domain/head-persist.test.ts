import { describe, expect, it } from 'vitest'
import {
  decideHeadFact,
  HEAD_FACT_HEARTBEAT_MS,
  HEAD_FACT_MAX_REVIEW_COUNT,
  type HeadFactInput,
} from './head-persist'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const input = (overrides: Partial<HeadFactInput> = {}): HeadFactInput => ({
  readAt: NOW,
  googleTotal: 120,
  googleAverage: 4.6,
  hasCompletedListing: true,
  newest: { reviewCount: 120, averageRating: 4.6, observedAt: ago(1 * HOUR_MS) },
  ...overrides,
})

describe('decideHeadFact: when a head check stores Google’s own numbers', () => {
  it('writes nothing while the newest fact says what Google says and is recent', () => {
    expect(decideHeadFact(input())).toEqual({ write: false, reason: 'unchanged' })
  })

  it('writes when Google’s total moved', () => {
    const decision = decideHeadFact(input({ googleTotal: 121 }))

    expect(decision).toMatchObject({ write: true, reason: 'changed' })
  })

  it('writes when Google’s average moved, however small the move', () => {
    const decision = decideHeadFact(input({ googleAverage: 4.61 }))

    expect(decision).toMatchObject({ write: true, reason: 'changed' })
  })

  it('writes a heartbeat once the newest fact is six hours old, so Goals’ 24 hour rule never lapses on a quiet Property', () => {
    const decision = decideHeadFact(
      input({
        newest: {
          reviewCount: 120,
          averageRating: 4.6,
          observedAt: ago(HEAD_FACT_HEARTBEAT_MS),
        },
      }),
    )

    expect(decision).toMatchObject({ write: true, reason: 'heartbeat' })
  })

  it('does not write a heartbeat a millisecond before the six hours are up', () => {
    const decision = decideHeadFact(
      input({
        newest: {
          reviewCount: 120,
          averageRating: 4.6,
          observedAt: ago(HEAD_FACT_HEARTBEAT_MS - 1),
        },
      }),
    )

    expect(decision).toEqual({ write: false, reason: 'unchanged' })
  })

  it('never writes before the epoch has its first completed listing, whatever Google says', () => {
    const decision = decideHeadFact(
      input({ hasCompletedListing: false, googleTotal: 500, newest: null }),
    )

    expect(decision).toEqual({ write: false, reason: 'no_completed_listing' })
  })

  it('writes the first fact when a completed listing exists but the newest fact cannot be found', () => {
    const decision = decideHeadFact(input({ newest: null }))

    expect(decision).toMatchObject({ write: true, reason: 'changed' })
  })

  it('compares a zero total with no average as unchanged against a zero fact', () => {
    const decision = decideHeadFact(
      input({
        googleTotal: 0,
        googleAverage: null,
        newest: { reviewCount: 0, averageRating: null, observedAt: ago(HOUR_MS) },
      }),
    )

    expect(decision).toEqual({ write: false, reason: 'unchanged' })
  })

  it('writes when a location first shows reviews after a zero fact', () => {
    const decision = decideHeadFact(
      input({
        googleTotal: 1,
        googleAverage: 5,
        newest: { reviewCount: 0, averageRating: null, observedAt: ago(HOUR_MS) },
      }),
    )

    expect(decision).toMatchObject({ write: true, reason: 'changed' })
  })

  it.each([
    ['a total over the cap', HEAD_FACT_MAX_REVIEW_COUNT + 1, 4.5],
    ['a negative total', -1, 4.5],
    ['a positive total with no average', 5, null],
    ['an average above five', 5, 5.1],
    ['a zero total with an average', 0, 4],
  ])('writes no fact for %s: the table cannot hold it', (_label, total, average) => {
    const decision = decideHeadFact(input({ googleTotal: total, googleAverage: average }))

    expect(decision).toEqual({ write: false, reason: 'not_storable' })
  })

  it('stamps the fact with the read time when that is after the newest fact', () => {
    const decision = decideHeadFact(input({ googleTotal: 121 }))

    expect(decision).toMatchObject({ write: true, numbersObservedAt: NOW })
  })

  it('stamps the fact one millisecond after the newest fact when the read is not later, so two facts never share an instant', () => {
    const decision = decideHeadFact(
      input({
        googleTotal: 121,
        newest: { reviewCount: 120, averageRating: 4.6, observedAt: NOW },
      }),
    )

    expect(decision).toMatchObject({
      write: true,
      numbersObservedAt: new Date(NOW.getTime() + 1),
    })
  })
})
