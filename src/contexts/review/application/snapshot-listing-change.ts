// Review context — a Google listing that changed between a run's two scans.
//
// A snapshot run lists a location twice. It may remove a Review only after the
// second (confirmation) listing returned exactly the reviews the first (main)
// one did, so a run whose confirmation finds a different set ends without
// removing anything. Until 2026-10-19 that always failed the sync loudly as
// `confirmation_set_changed`: a Sentry error, an alert, a dead letter and a
// repair latch.
//
// Most such runs are lost, not broken. A guest who posts while a run is
// between its two listings (or Google hiding or restoring a review then)
// changes the set, and the next run lists one that holds still. On the closed
// beta the largest location (3,714 reviews, about three minutes a listing) saw
// this once in 189 overnight runs, and its next run completed. Such a run now
// ends as `listing_changed`: the sync job starts a fresh run at once and
// records no failure.
//
// A listing that changes under run after run is something else: Google not
// paging the same way twice, or a paging defect of ours. That stays as loud as
// it was. The store decides which one a run is when it records the failure,
// from the Property's runs just before it (ADR 0055, note 2026-10-19).

import type { ReviewProviderSnapshotFailureCode } from './ports/review-provider-snapshot.repository'

/**
 * How many runs in a row may see their listing change quietly; the next one is
 * loud. Two, because:
 *
 * - A change is rare: one run in 189 on the night it was first seen. Taken as
 *   independent that makes two in a row about 1 in 36,000 and three about 1 in
 *   6.8 million, so a third is a defect, not a guest.
 * - Changes are not independent. The fresh run starts at once and covers the
 *   next few minutes of the same morning: a check-out wave, or a portal
 *   sending guests to Google, can post a second review into the second run.
 *   One quiet restart would turn that burst into an alert.
 * - A defect changes the listing on every run, so it is loud on the third,
 *   back to back with the first two (about ten minutes on the largest
 *   location), and costs at most two extra listings of Google quota.
 */
export const LISTING_CHANGE_QUIET_RUNS = 2

/** A run that ended either way the confirmation can find a changed set. */
const SET_CHANGED: ReadonlySet<ReviewProviderSnapshotFailureCode | null> = new Set([
  'listing_changed',
  'confirmation_set_changed',
])

/**
 * The code to record for a run whose confirmation found a different set.
 *
 * `previous` is how the Property's runs in the same source epoch that ended
 * just before this one ended, newest first: their failure codes, null for a
 * completed run. The caller leaves out runs lost to a cursor store restart
 * (`cursor_lost`): they ended before they could compare their listings, so
 * they neither break a run of changes nor add to one. Only the first
 * {@link LISTING_CHANGE_QUIET_RUNS} entries are read.
 *
 * Loud runs count as changes too, so once a Property's listing has been loud
 * it stays loud until a run completes or ends some other way.
 */
export function listingChangeFailureCode(
  previous: ReadonlyArray<ReviewProviderSnapshotFailureCode | null>,
): 'listing_changed' | 'confirmation_set_changed' {
  const recent = previous.slice(0, LISTING_CHANGE_QUIET_RUNS)
  const repeating =
    recent.length === LISTING_CHANGE_QUIET_RUNS &&
    recent.every((code) => SET_CHANGED.has(code))
  return repeating ? 'confirmation_set_changed' : 'listing_changed'
}
