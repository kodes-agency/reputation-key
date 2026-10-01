// Portal context — how old an approval may be before the public edge stops
// serving the address behind it.
//
// Revalidation is scheduled every 15 minutes. Two intervals allow one delayed
// run without keeping an indefinitely stale approval live at the public edge.
// One constant, read by the guest edge and by the editor's live preview, so the
// preview cannot drift from what guests are served.

export const APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS = 30 * 60 * 1_000
