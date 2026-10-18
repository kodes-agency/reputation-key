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

import {
  REVIEW_PROVIDER_SNAPSHOT_PAGE_SIZE,
  type ReviewProviderSnapshotRun,
} from './ports/review-provider-snapshot.repository'

/**
 * A gap may reach 2% of Google's total, rounded down. Proportional because a
 * large location drifts by more than a small one, and small: two counts that
 * disagree by more than this are not Google's bookkeeping, they are a listing
 * that went wrong.
 */
export const SNAPSHOT_COUNT_GAP_PERCENT = 2

/** One review is always allowed, so a small location is not held to 0. */
export const SNAPSHOT_COUNT_GAP_MIN = 1

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

/** The largest gap accepted for a Google total of `expected`. */
export const snapshotCountGapTolerance = (expected: number): number =>
  Math.min(
    SNAPSHOT_COUNT_GAP_MAX,
    Math.max(
      SNAPSHOT_COUNT_GAP_MIN,
      Math.floor((expected * SNAPSHOT_COUNT_GAP_PERCENT) / 100),
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
 * - every page before the last came back full (`pages` is the fewest pages
 *   `unique` reviews fill). The "less than one page" bound assumes Google
 *   pages as we ask; when it sends a short page early, a lost page could hide
 *   fewer reviews than the tolerance, so the gap is refused.
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
