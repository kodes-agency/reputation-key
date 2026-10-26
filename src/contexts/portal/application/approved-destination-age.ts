// Portal context — how old an approval may be before the public edge stops
// serving the address behind it, and how old it may be before the job takes it
// again.
//
// Revalidation is scheduled every 15 minutes (`PORTAL_BACKGROUND_JOB_ROWS`),
// with a run budget of 5 minutes. A run is due for every approval at least 10
// minutes old, so an approval validated anywhere in one run, even at the end of
// its budget, is due again at the start of the next: it is refreshed every
// interval, about 15 minutes after the last time. The public edge accepts one
// up to 30 minutes old, so a run may start as much as 10 minutes late (the
// cutoff less the interval less the run budget) without a link dropping.
//
// That holds only while one run can take everything that is due. A run takes
// pages of 50 destinations, pending and approved together, oldest first, from
// all tenants, and keeps taking them until a page comes back short (nothing
// else is due), a page validated and quarantined nothing, or 150 seconds have
// passed (`createRevalidateApprovedDestinationsHandler`). The 150 seconds are
// half the job's 5 minute timeout, which fails a run that passes it, so the
// page in flight when the budget ends still finishes inside it. Capacity is
// therefore a time budget, not a page: sequential checks of about a second
// each take a few hundred destinations in one run. Beyond that the oldest are
// taken first and the gap grows toward the cutoff.
//
// A row that never validates (an unreachable site, a Property whose scope is
// refused) keeps its place at the head of every page, because nothing moves
// it. Within one run it is tried again on each page, and a page made only of
// such rows ends the run, so 50 of them hide everything behind them. That is
// review finding S09-02 (deferred: the fix is a per-row retry clock, which
// needs a migration).
//
// The constants are read by the job and by the guest edge and the editor's
// live preview, so the preview cannot drift from what guests are served.
// `approved-destination-age.test.ts` holds the arithmetic of the first
// paragraph, not the capacity of the page.

export const APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS = 30 * 60 * 1_000

export const APPROVED_DESTINATION_REVALIDATION_DUE_AFTER_MS = 10 * 60 * 1_000
