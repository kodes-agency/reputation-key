// Portal context — how old an approval may be before the public edge stops
// serving the address behind it, and how old it may be before the job takes it
// again.
//
// Revalidation is scheduled every 15 minutes (`PORTAL_BACKGROUND_JOB_ROWS`),
// with a run budget of 5 minutes. A run takes every approval at least 10
// minutes old, so an approval validated anywhere in one run, even at the end of
// its budget, is due again at the start of the next: it is refreshed every
// interval, about 15 minutes after the last time. The public edge accepts one
// up to 30 minutes old, so a run may start as much as 10 minutes late (the
// cutoff less the interval less the run budget) without a link dropping. The
// constants are read by the job and by the guest edge and the editor's live
// preview, so the preview cannot drift from what guests are served.
// `approved-destination-age.test.ts` holds the arithmetic.

export const APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS = 30 * 60 * 1_000

export const APPROVED_DESTINATION_REVALIDATION_DUE_AFTER_MS = 10 * 60 * 1_000
