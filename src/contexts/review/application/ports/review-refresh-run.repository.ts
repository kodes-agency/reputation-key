// Review context — refresh sweep run repository port (BQC-1.5).
// One row per sweep run: resume cursor, counts, oldest due expiry,
// failures, terminal state. Content-free operational state only.

export type RefreshRunCursor = Readonly<{
  contentExpiresAt: Date
  reviewId: string
}>

export type RefreshRunStatus = 'running' | 'completed' | 'budget_exhausted' | 'failed'

export type RefreshRun = Readonly<{
  id: string
  startedAt: Date
  finishedAt: Date | null
  cursorContentExpiresAt: Date | null
  cursorReviewId: string | null
  batchSize: number
  maxBatches: number
  batchesProcessed: number
  candidatesSeen: number
  refreshDueCount: number
  enqueuedCount: number
  enqueueFailedCount: number
  oldestDueContentExpiresAt: Date | null
  status: RefreshRunStatus
  failureReason: string | null
  nextAttemptAt: Date | null
}>

export type CreateRefreshRunInput = Readonly<{
  batchSize: number
  maxBatches: number
  cursor?: RefreshRunCursor | null
}>

export type RefreshRunPatch = Readonly<
  Partial<{
    cursor: RefreshRunCursor | null
    batchesProcessed: number
    candidatesSeen: number
    refreshDueCount: number
    enqueuedCount: number
    enqueueFailedCount: number
    oldestDueContentExpiresAt: Date | null
    status: RefreshRunStatus
    failureReason: string | null
    finishedAt: Date
    nextAttemptAt: Date
  }>
>

export type ReviewRefreshRunRepository = Readonly<{
  createRun(input: CreateRefreshRunInput): Promise<RefreshRun>
  updateRun(id: string, patch: RefreshRunPatch): Promise<void>
  /** Latest run by startedAt (for cursor resume on the next scheduled run). */
  findLatestRun(): Promise<RefreshRun | null>
}>
