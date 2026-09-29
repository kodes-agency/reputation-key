export type AiReviewAnalysisReopenResult = Readonly<{
  /** Reviews given a fresh analysis sequence and a backfill event. */
  reopened: number
  /**
   * Reviews that would qualify but have used every reopen: they stay settled
   * as not analysable. Reported on every sweep so they are never silent.
   */
  leftUnanalysed: number
}>

export type AiReviewAnalysisReopenPort = Readonly<{
  /**
   * Reopen text reviews whose current analysis settled without a result
   * because its operation gave up for a reason that says nothing about the
   * review (ADR 0058). Each gets a fresh analysis sequence and an
   * `ai.review_analysis.backfill_requested` event, in one transaction per
   * Property, so it is queued again through the ordinary path. At most
   * `limit` reviews per call.
   */
  reopenAbandoned(
    input: Readonly<{ limit: number; occurredAt: Date }>,
  ): Promise<AiReviewAnalysisReopenResult>
}>
