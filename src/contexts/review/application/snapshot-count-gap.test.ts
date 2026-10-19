import { describe, expect, it } from 'vitest'
import type { ReviewProviderSnapshotRun } from './ports/review-provider-snapshot.repository'
import {
  SNAPSHOT_COUNT_GAP_MAX,
  snapshotCountAgreement,
  snapshotCountGapTolerance,
  snapshotRunCountAgreement,
} from './snapshot-count-gap'

describe('snapshotCountGapTolerance', () => {
  it.each([
    // 10% of a tiny total rounds to 0 or 1, so the minimum of 1 holds.
    { expected: 1, tolerance: 1 },
    { expected: 5, tolerance: 1 },
    { expected: 10, tolerance: 1 },
    { expected: 19, tolerance: 1 },
    // Past 10, the 10% safety limit (rounded down) is what binds.
    { expected: 20, tolerance: 2 },
    { expected: 30, tolerance: 3 },
    { expected: 40, tolerance: 4 },
    { expected: 49, tolerance: 4 },
    // From 50 up, the flat 5 applies.
    { expected: 50, tolerance: 5 },
    { expected: 82, tolerance: 5 },
    { expected: 86, tolerance: 5 },
    { expected: 100, tolerance: 5 },
    { expected: 250, tolerance: 5 },
    { expected: 299, tolerance: 5 },
    // From 300 up, 2% of the total grows past the flat 5.
    { expected: 300, tolerance: 6 },
    { expected: 500, tolerance: 10 },
    { expected: 2_450, tolerance: 49 },
  ])(
    'allows $tolerance for a Google total of $expected (5, or 2%, capped at 10%)',
    (row) => {
      expect(snapshotCountGapTolerance(row.expected)).toBe(row.tolerance)
    },
  )

  it.each([2_500, 2_600, 10_000])(
    'never reaches one page, however large the total (%i)',
    (expected) => {
      expect(snapshotCountGapTolerance(expected)).toBe(SNAPSHOT_COUNT_GAP_MAX)
      expect(SNAPSHOT_COUNT_GAP_MAX).toBe(49)
    },
  )

  it('never exceeds 10% of the total, so a tiny location cannot be mostly unlisted', () => {
    for (let expected = 1; expected <= 300; expected += 1) {
      const tolerance = snapshotCountGapTolerance(expected)
      expect(tolerance).toBeGreaterThanOrEqual(1)
      expect(tolerance).toBeLessThanOrEqual(
        Math.max(1, Math.floor((expected * 10) / 100)),
      )
    }
  })
})

describe('snapshotCountAgreement', () => {
  it('is exact when the list returns as many reviews as Google counts', () => {
    expect(snapshotCountAgreement({ expected: 81, unique: 81, pages: 2 })).toEqual({
      kind: 'exact',
    })
  })

  it('accepts one review fewer than Google counts as a gap', () => {
    expect(snapshotCountAgreement({ expected: 82, unique: 81, pages: 2 })).toEqual({
      kind: 'gap',
      expected: 82,
      unique: 81,
      gap: 1,
    })
  })

  it('accepts one review more than Google counts as a gap', () => {
    expect(snapshotCountAgreement({ expected: 19, unique: 20, pages: 1 })).toEqual({
      kind: 'gap',
      expected: 19,
      unique: 20,
      gap: 1,
    })
  })

  it('accepts the largest gap the tolerance allows', () => {
    expect(snapshotCountAgreement({ expected: 2_600, unique: 2_551, pages: 52 })).toEqual(
      { kind: 'gap', expected: 2_600, unique: 2_551, gap: 49 },
    )
  })

  it('accepts the gap Sentry saw: 86 counted, 84 listed over two pages', () => {
    // JAVASCRIPT-TANSTACKSTART-REACT-4, closed beta, 2026-10-19: earlier runs
    // that day had gaps of 1 and completed; this one had 2 and failed.
    expect(snapshotCountAgreement({ expected: 86, unique: 84, pages: 2 })).toEqual({
      kind: 'gap',
      expected: 86,
      unique: 84,
      gap: 2,
    })
  })

  it('refuses a gap beyond the tolerance', () => {
    expect(snapshotCountAgreement({ expected: 86, unique: 70, pages: 2 })).toEqual({
      kind: 'mismatch',
    })
  })

  // For each total: a list short of the total by exactly the tolerance and by
  // one more, then the same with a list longer than the total.
  // 5 -> 1, 10 -> 1, 20 -> 2, 30 -> 3, 86 -> 5, 2,600 -> 49. `pages` is what
  // the listed reviews fill at 50 a page, as a clean listing would take.
  it.each([
    { expected: 5, unique: 4, pages: 1, verdict: 'gap' },
    { expected: 5, unique: 3, pages: 1, verdict: 'mismatch' },
    { expected: 5, unique: 6, pages: 1, verdict: 'gap' },
    { expected: 5, unique: 7, pages: 1, verdict: 'mismatch' },
    { expected: 10, unique: 9, pages: 1, verdict: 'gap' },
    { expected: 10, unique: 8, pages: 1, verdict: 'mismatch' },
    { expected: 10, unique: 11, pages: 1, verdict: 'gap' },
    { expected: 10, unique: 12, pages: 1, verdict: 'mismatch' },
    { expected: 20, unique: 18, pages: 1, verdict: 'gap' },
    { expected: 20, unique: 17, pages: 1, verdict: 'mismatch' },
    { expected: 20, unique: 22, pages: 1, verdict: 'gap' },
    { expected: 20, unique: 23, pages: 1, verdict: 'mismatch' },
    { expected: 30, unique: 27, pages: 1, verdict: 'gap' },
    { expected: 30, unique: 26, pages: 1, verdict: 'mismatch' },
    { expected: 30, unique: 33, pages: 1, verdict: 'gap' },
    { expected: 30, unique: 34, pages: 1, verdict: 'mismatch' },
    { expected: 86, unique: 81, pages: 2, verdict: 'gap' },
    { expected: 86, unique: 80, pages: 2, verdict: 'mismatch' },
    { expected: 86, unique: 91, pages: 2, verdict: 'gap' },
    { expected: 86, unique: 92, pages: 2, verdict: 'mismatch' },
    { expected: 2_600, unique: 2_551, pages: 52, verdict: 'gap' },
    { expected: 2_600, unique: 2_550, pages: 51, verdict: 'mismatch' },
    { expected: 2_600, unique: 2_649, pages: 53, verdict: 'gap' },
    { expected: 2_600, unique: 2_650, pages: 53, verdict: 'mismatch' },
  ])(
    'is a $verdict at $expected counted and $unique listed (at or one past the tolerance)',
    ({ verdict, ...listing }) => {
      expect(snapshotCountAgreement(listing).kind).toBe(verdict)
    },
  )

  it('reports the size of the gap it accepted', () => {
    expect(snapshotCountAgreement({ expected: 86, unique: 81, pages: 2 })).toEqual({
      kind: 'gap',
      expected: 86,
      unique: 81,
      gap: 5,
    })
    expect(snapshotCountAgreement({ expected: 86, unique: 91, pages: 2 })).toEqual({
      kind: 'gap',
      expected: 86,
      unique: 91,
      gap: 5,
    })
  })

  it.each([
    { expected: 1, unique: 2, pages: 1, verdict: 'gap' },
    { expected: 2, unique: 1, pages: 1, verdict: 'gap' },
    { expected: 2, unique: 4, pages: 1, verdict: 'mismatch' },
    { expected: 3, unique: 1, pages: 1, verdict: 'mismatch' },
    { expected: 0, unique: 0, pages: 1, verdict: 'exact' },
  ])(
    'treats a tiny total by the same rule ($expected counted, $unique listed)',
    ({ verdict, ...listing }) => {
      expect(snapshotCountAgreement(listing).kind).toBe(verdict)
    },
  )

  it('refuses a missing full page even where 2% of the total would cover it', () => {
    // 2% of 2,600 is 52, but a page carries 50: the cap keeps a page out.
    expect(snapshotCountAgreement({ expected: 2_600, unique: 2_550, pages: 51 })).toEqual(
      { kind: 'mismatch' },
    )
  })

  it('refuses a gap when Google sent a short page before the last one', () => {
    // 81 reviews fill two pages of 50. Three pages means Google paged smaller
    // than asked, so "less than one page" no longer bounds what a lost page hid.
    expect(snapshotCountAgreement({ expected: 82, unique: 81, pages: 3 })).toEqual({
      kind: 'mismatch',
    })
  })

  it.each([
    { expected: 1, unique: 0, pages: 1 },
    { expected: 0, unique: 1, pages: 1 },
  ])('refuses a gap with an empty side ($expected vs $unique)', (listing) => {
    expect(snapshotCountAgreement(listing)).toEqual({ kind: 'mismatch' })
  })

  it.each([
    { expected: 82.5, unique: 81, pages: 2 },
    { expected: 82, unique: Number.NaN, pages: 2 },
    { expected: 82, unique: 81, pages: 0 },
  ])('refuses counts that are not whole page and review counts', (listing) => {
    expect(snapshotCountAgreement(listing)).toEqual({ kind: 'mismatch' })
  })
})

describe('snapshotRunCountAgreement', () => {
  const run = (
    overrides: Partial<
      Pick<
        ReviewProviderSnapshotRun,
        'expectedProviderTotal' | 'mainUniqueCount' | 'mainPageIndex'
      >
    >,
  ) => ({
    expectedProviderTotal: 82,
    mainUniqueCount: 81,
    mainPageIndex: 2,
    ...overrides,
  })

  it("reads the run's main listing", () => {
    expect(snapshotRunCountAgreement(run({}))).toEqual({
      kind: 'gap',
      expected: 82,
      unique: 81,
      gap: 1,
    })
  })

  it('refuses a run that never froze a Google total', () => {
    expect(snapshotRunCountAgreement(run({ expectedProviderTotal: null }))).toEqual({
      kind: 'mismatch',
    })
  })
})
