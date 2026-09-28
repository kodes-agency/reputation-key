/**
 * How often an open progress view re-reads Review Analysis counts while they
 * move. The backlog drain settles several reviews a second (ADR 0058), so a
 * slower poll would trail the work it reports.
 */
export const REVIEW_ANALYSIS_PROGRESS_POLL_MS = 3_000

/** Poll only while analysis is running; a caught-up or disabled read stays put. */
export function reviewAnalysisProgressRefetchInterval(
  query: Readonly<{ state: Readonly<{ data?: Readonly<{ status: string }> }> }>,
): number | false {
  return query.state.data?.status === 'analysing'
    ? REVIEW_ANALYSIS_PROGRESS_POLL_MS
    : false
}
