// Review context — which snapshot failures park a Property instead of failing
// the sync job (pure).
//
// Most coded failures fail the job: the step that failed the run throws, BullMQ
// retries it, and the job is dead-lettered once its attempts are spent. A few
// fail identically on every run until something outside RepKey changes, so
// retrying them only fills the dead-letter queue and latches the family's
// repair state while the discovery ladder retries the Property on its own. Those
// are parked: the code, the time and the retry date are recorded on the
// Property (`review_sync_state.error_class`, so `sync.failed-nonzero` keeps
// naming it) and the job ends normally.

import type { ReviewProviderSnapshotFailureCode } from './ports/review-provider-snapshot.repository'
import { historyImportFailureReason } from './historical-import-outcome'

/**
 * Whether a run that ended in `code` parks its Property:
 *
 * - a location over the review or page cap (`review_cap_exceeded`,
 *   `page_cap_exceeded`): it stays over until the cap or the location changes,
 *   so it waits a day;
 * - `provider_rejected`: Google answered 400 or 404 for the location, which
 *   stays that way until the location changes in Google Business Profile, so it
 *   waits on the ordinary retry ladder.
 */
export const isParkedSnapshotFailure = (
  code: ReviewProviderSnapshotFailureCode,
): boolean =>
  code === 'provider_rejected' ||
  historyImportFailureReason(code) === 'location_too_large'
