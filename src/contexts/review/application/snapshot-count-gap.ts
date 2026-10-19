// Review context — how far Google's review total may disagree with its list.
//
// Every page of a Google review listing carries the location's own
// `totalReviewCount`. A snapshot run used to fail as `set_mismatch` unless the
// unique reviews the list returned matched that total exactly, because a run
// also removes the stored Reviews that vanished from Google, and a removal is
// only safe after a complete listing.
//
// Google's total and its list do not always agree. On the closed beta one
// location reports 82 and lists 81 unique reviews on every read, so every run
// since its import failed and none ever completed, while all 81 reviews were
// stored. Another reported 19 and listed 20 for two days. Neither difference
// is a listing RepKey cut short; it is Google counting something its list does
// not show (or the reverse).
//
// The owner's decision (2026-10-18, ADR 0055 note): accept a small gap,
// complete the run, and remove nothing. A listing that disagrees with Google's
// total is never grounds for removing anything; removals resume on the first
// run whose numbers agree again.
//
// The first tolerance, 2% of the total, was too tight for a small location: on
// 2026-10-19 one reporting 86 listed 84 unique reviews over two pages, a gap of
// 2 where 2% allowed 1, and its sync failed as `set_mismatch` after two earlier
// runs that day (gaps of 1) had completed. The owner's decision of that day
// widened it to five reviews, or 2% on a big location, still under one page.

import {
  REVIEW_PROVIDER_SNAPSHOT_PAGE_SIZE,
  type ReviewProviderSnapshotRun,
} from './ports/review-provider-snapshot.repository'

/**
 * The gap a location of any size may show: at least this many reviews. Google
 * miscounts by a few reviews whatever the size of the location, so a flat
 * figure serves the small and middling ones; 2% of the total would allow only
 * 1 below a total of 100.
 */
const SNAPSHOT_COUNT_GAP_FLAT = 5

/**
 * A big location drifts by more than a small one, so past the flat figure the
 * gap may reach 2% of Google's total, rounded down (it overtakes the flat 5 at
 * a total of 300).
 */
const SNAPSHOT_COUNT_GAP_PERCENT = 2

/**
 * The safety limit on a small total: the gap never reaches more than 10% of
 * it, rounded down. Without it a flat 5 on a location of 10 would pass a list
 * missing half its reviews; that is not Google's bookkeeping, so it stays a
 * loud failure. It binds below a total of 50 (5 is 10% of 50).
 */
const SNAPSHOT_COUNT_GAP_SAFETY_PERCENT = 10

/** One review is always allowed, so a tiny location is not held to 0. */
const SNAPSHOT_COUNT_GAP_MIN = 1

/**
 * The largest gap ever accepted: strictly less than one page. A page that
 * went missing in the middle of a listing takes a full page of reviews with
 * it, so it can never pass as a gap, however large the location (2% of
 * 2,600 would otherwise be 52).
 */
export const SNAPSHOT_COUNT_GAP_MAX = REVIEW_PROVIDER_SNAPSHOT_PAGE_SIZE - 1

export type SnapshotCountAgreement =
  | Readonly<{ kind: 'exact' }>
  | Readonly<{ kind: 'gap'; expected: number; unique: number; gap: number }>
  | Readonly<{ kind: 'mismatch' }>

const EXACT: SnapshotCountAgreement = { kind: 'exact' }
const MISMATCH: SnapshotCountAgreement = { kind: 'mismatch' }

const wholePercentOf = (total: number, percent: number): number =>
  Math.floor((total * percent) / 100)

/**
 * The largest gap accepted for a Google total of `expected`:
 *
 *     max(1, min(49, max(5, floor(2% x total)), floor(10% x total)))
 *
 * Read from the inside: the gap may reach 5 reviews, or 2% of the total on a
 * big location (whichever is more); never 10% of the total, so a tiny location
 * cannot pass mostly unlisted; never a whole page (49); and never less than 1.
 * It gives 1 up to a total of 19, 2 at 20, 3 at 30, 5 from 50 to 299 (86 -> 5),
 * 2% from 300, and 49 from 2,450 up (2,600 -> 49).
 */
export const snapshotCountGapTolerance = (expected: number): number =>
  Math.max(
    SNAPSHOT_COUNT_GAP_MIN,
    Math.min(
      SNAPSHOT_COUNT_GAP_MAX,
      Math.max(
        SNAPSHOT_COUNT_GAP_FLAT,
        wholePercentOf(expected, SNAPSHOT_COUNT_GAP_PERCENT),
      ),
      wholePercentOf(expected, SNAPSHOT_COUNT_GAP_SAFETY_PERCENT),
    ),
  )

const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

/**
 * How one finished listing compares with Google's total.
 *
 * - `exact`: the list returned as many unique reviews as Google counts. The
 *   only listing removals may be based on.
 * - `gap`: they differ by no more than the tolerance. The run may complete,
 *   but it removes nothing.
 * - `mismatch`: anything else, which fails the run as `set_mismatch`.
 *
 * A gap is accepted only when:
 *
 * - neither side is empty. A list with nothing in it, or a total of zero
 *   against a list that has reviews, is a contradiction, not a small gap;
 * - the listing took no more pages than its reviews fill at 50 a page
 *   (`pages === ceil(unique / 50)`), so all its pages together came back less
 *   than one page short. The "less than one page" bound assumes Google pages
 *   as we ask; a listing paged smaller than that could lose a short page that
 *   hides fewer reviews than the tolerance, so its gap is refused. The run
 *   row keeps no per-page counts, so this cannot prove each page before the
 *   last was full, only that their shortfall adds up to under one page.
 *
 * Stability across runs (the same gap on this Property's previous run) is
 * deliberately not required. Inside one run the gap is already stable: Google
 * must report the same total and average on every page of two full listings,
 * and the confirmation listing must return exactly the reviews the main one
 * did. Since nothing is removed, completing such a run only records what is
 * already stored and Google's own aggregate. Requiring a previous run would
 * fail every first import with a gap, sending its owner a failed-import
 * notice, and a failed previous run does not record whether its listing ever
 * reached the end.
 */
export function snapshotCountAgreement(
  listing: Readonly<{ expected: number; unique: number; pages: number }>,
): SnapshotCountAgreement {
  const { expected, unique, pages } = listing
  if (!isCount(expected) || !isCount(unique) || !isCount(pages)) return MISMATCH
  if (unique === expected) return EXACT
  if (expected === 0 || unique === 0) return MISMATCH
  if (pages !== Math.ceil(unique / REVIEW_PROVIDER_SNAPSHOT_PAGE_SIZE)) return MISMATCH
  const gap = Math.abs(expected - unique)
  if (gap > snapshotCountGapTolerance(expected)) return MISMATCH
  return { kind: 'gap', expected, unique, gap }
}

/** The same comparison for a run's main listing. A run that never froze a
 * Google total has nothing to agree with. */
export const snapshotRunCountAgreement = (
  run: Pick<
    ReviewProviderSnapshotRun,
    'expectedProviderTotal' | 'mainUniqueCount' | 'mainPageIndex'
  >,
): SnapshotCountAgreement =>
  run.expectedProviderTotal == null
    ? MISMATCH
    : snapshotCountAgreement({
        expected: run.expectedProviderTotal,
        unique: run.mainUniqueCount,
        pages: run.mainPageIndex,
      })
