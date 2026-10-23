// Review context — a Google listing that moved while a snapshot run read it.
//
// A snapshot run lists a location twice, page by page. It may remove a Review
// only after the second (confirmation) listing returned exactly the reviews
// the first (main) one did, and only from pages that all agree on one total
// and one average. A run that sees the listing move under it ends without
// removing anything. Until 2026-10-19 that always failed the sync loudly: a
// Sentry error, an alert, a dead letter and a repair latch.
//
// Most such runs are lost, not broken. A guest who posts while a run is
// reading (or Google hiding or restoring a review then) moves the listing,
// and the next run reads one that holds still. The listing moves in four ways:
//
// - the confirmation finds a different set than the main scan did
//   (`confirmation_set_changed`, the first to be made quiet, 2026-10-19: the
//   largest beta location, 3,714 reviews, saw it once in 189 overnight runs);
// - Google's total differs from one page to the next (`total_changed`): the
//   same location failed two runs in a row on 2026-10-20 (3,716 expected, lost
//   at page 7; 3,717 at page 65 of 75), because guests posted while a run of
//   about 15 minutes was listing, and its next two runs completed;
// - Google's average differs from one page to the next (`average_changed`):
//   a guest re-rated a review (a new review moves the total first);
// - one review closes a main-scan page and opens the next (`page_overlap`,
//   stored as `duplicate_resource` when loud): Google lists newest-updated
//   first by default, so a review posted or edited mid-scan shifts every
//   later page by one. The confirmation scan's twin of it was already
//   `confirmation_set_changed`.
//
// Such a run now ends as `listing_changed`: the sync job starts a fresh run at
// once and records no failure. None of them gets as far as its apply step, so
// none removes anything, and a run that stops mid-scan has recorded no first
// miss either.
//
// A listing that moves under run after run is something else: Google not
// paging the same way twice, or a paging defect of ours. That stays as loud as
// it was, under the code that says what moved. The store decides which one a
// run is when it records the failure, from the Property's runs just before it
// (ADR 0055, notes 2026-10-19 and 2026-10-20).
//
// What does not count as a move, and stays loud on its first run: a review
// twice on ONE page (Google's page is broken, a page being one response), and
// one review id linked to two provider resources (our mapping is broken).

import type { ReviewProviderSnapshotFailureCode } from './ports/review-provider-snapshot.repository'

/**
 * How many runs in a row may see their listing move quietly; the next one is
 * loud. Two, because:
 *
 * - A move is rare: one run in 189 on the night it was first seen, 3 in 143
 *   on the largest location over five days (two of them back to back). Taken
 *   as independent that makes two in a row about 1 in 36,000 and three about 1
 *   in 6.8 million, so a third is a defect, not a guest.
 * - Moves are not independent. The fresh run starts at once and covers the
 *   next few minutes of the same morning: a check-out wave, or a portal
 *   sending guests to Google, can post a second review into the second run.
 *   One quiet restart would turn that burst into an alert.
 * - A defect moves the listing on every run, so it is loud on the third, back
 *   to back with the first two (under 45 minutes on the largest
 *   location at today's 15-minute runs), and costs at most two extra listings
 *   of Google quota.
 */
export const LISTING_CHANGE_QUIET_RUNS = 2

/**
 * What a failing step asks the store to record when the listing moved under
 * it. All but `page_overlap` are failure codes already; `page_overlap` is the
 * main-scan twin of `confirmation_set_changed` (a review seen on two pages of
 * one scan), which the store records as `duplicate_resource` when loud so that
 * the stored codes stay the closed list Sentry tags and alerts know.
 */
export type ListingMoveRequest =
  'confirmation_set_changed' | 'total_changed' | 'average_changed' | 'page_overlap'

/** What a failing step may ask the store to record. */
export type SnapshotFailureRequest = ReviewProviderSnapshotFailureCode | 'page_overlap'

const LISTING_MOVES: ReadonlySet<SnapshotFailureRequest> = new Set<ListingMoveRequest>([
  'confirmation_set_changed',
  'total_changed',
  'average_changed',
  'page_overlap',
])

/** Whether the failure is a listing that moved under the run, which is quiet
 * until it repeats; every other failure is recorded as asked. */
export function isListingMove(
  request: SnapshotFailureRequest,
): request is ListingMoveRequest {
  return LISTING_MOVES.has(request)
}

/** The code a request is stored with when nothing makes it quiet. */
export function storedFailureCode(
  request: SnapshotFailureRequest,
): ReviewProviderSnapshotFailureCode {
  return request === 'page_overlap' ? 'duplicate_resource' : request
}

/**
 * Run endings that count as a listing that moved. `duplicate_resource` is here
 * because a loud `page_overlap` is stored as it; a run that ended on a review
 * twice in one page is counted along with it, which can only make the next
 * move loud sooner.
 */
const SET_CHANGED: ReadonlySet<ReviewProviderSnapshotFailureCode | null> = new Set([
  'listing_changed',
  'confirmation_set_changed',
  'total_changed',
  'average_changed',
  'duplicate_resource',
])

/**
 * The code to record for a run whose listing moved under it, `request` saying
 * how: `listing_changed` (quiet), or the request's own stored code once the
 * Property's runs keep moving.
 *
 * `previous` is how the Property's runs in the same source epoch that ended
 * just before this one ended, newest first: their failure codes, null for a
 * completed run. The caller leaves out runs lost to a cursor store restart
 * (`cursor_lost`) and runs ended by a Google connection that could not be used
 * (`connection_unusable`): they ended before they could compare their
 * listings, so they neither break a run of changes nor add to one. Only the first
 * {@link LISTING_CHANGE_QUIET_RUNS} entries are read.
 *
 * Moves of every kind count together, loud ones included, so once a Property's
 * listing has been loud it stays loud until a run completes or ends some other
 * way.
 */
export function listingChangeFailureCode(
  request: ListingMoveRequest,
  previous: ReadonlyArray<ReviewProviderSnapshotFailureCode | null>,
): ReviewProviderSnapshotFailureCode {
  const recent = previous.slice(0, LISTING_CHANGE_QUIET_RUNS)
  const repeating =
    recent.length === LISTING_CHANGE_QUIET_RUNS &&
    recent.every((code) => SET_CHANGED.has(code))
  return repeating ? storedFailureCode(request) : 'listing_changed'
}
