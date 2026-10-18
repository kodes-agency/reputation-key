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
    { expected: 1, tolerance: 1 },
    { expected: 19, tolerance: 1 },
    { expected: 82, tolerance: 1 },
    { expected: 99, tolerance: 1 },
    { expected: 100, tolerance: 2 },
    { expected: 149, tolerance: 2 },
    { expected: 150, tolerance: 3 },
    { expected: 500, tolerance: 10 },
    { expected: 2_450, tolerance: 49 },
  ])('allows $tolerance for a Google total of $expected (2%, never below 1)', (row) => {
    expect(snapshotCountGapTolerance(row.expected)).toBe(row.tolerance)
  })

  it.each([2_500, 2_600, 10_000])(
    'never reaches one page, however large the total (%i)',
    (expected) => {
      expect(snapshotCountGapTolerance(expected)).toBe(SNAPSHOT_COUNT_GAP_MAX)
      expect(SNAPSHOT_COUNT_GAP_MAX).toBe(49)
    },
  )
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

  it('refuses a gap beyond 2% of the total', () => {
    expect(snapshotCountAgreement({ expected: 82, unique: 70, pages: 2 })).toEqual({
      kind: 'mismatch',
    })
  })

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
