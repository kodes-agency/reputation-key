// Portal context — how old an approval may be before the public edge stops
// serving the address behind it, and how old it may be before the job takes it
// again.
//
// Revalidation is scheduled every 15 minutes (`portal-approved-destination-revalidation` in src/shared/jobs/job-definitions.ts),
// with a run budget of 5 minutes. A run is due for every approval at least 10
// minutes old, so an approval validated anywhere in one run, even at the end of
// its budget, is due again at the start of the next: it is refreshed every
// interval, about 15 minutes after the last time. The public edge accepts one
// up to 30 minutes old, so a run may start as much as 10 minutes late (the
// cutoff less the interval less the run budget) without a link dropping.
//
// A run has a 150-second paging budget, half the job timeout. It fixes its
// eligibility clock at the start and excludes ids already visited, so each row
// is visited at most once even when validation or authorization fails. Network
// failures keep lastValidatedAt unchanged and use a persisted retry time with
// exponential backoff capped at 15 minutes. Denied scopes are skipped without
// a network request or a write. The worker alerts when its budget is exhausted
// or an authorized site's network check still fails past the freshness limit.
//
// The constants are read by the job and by the guest edge and the editor's
// live preview, so the preview cannot drift from what guests are served.
// `approved-destination-age.test.ts` holds the arithmetic of the first
// paragraph, not the capacity of the page.

export const APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS = 30 * 60 * 1_000

export const APPROVED_DESTINATION_REVALIDATION_DUE_AFTER_MS = 10 * 60 * 1_000
