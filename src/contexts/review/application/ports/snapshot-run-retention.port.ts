import type { ObservationRetentionScope } from './observation-retention.port'

/**
 * Retention of provider snapshot runs and their members. Counts only: no
 * Review, Property or run identifier crosses it.
 */

export type SnapshotRunSweep = Readonly<{
  batches: number
  /** Runs deleted, each with its members and removal candidates. */
  runs: number
  /** Member rows deleted. */
  members: number
  /** True when the run stopped at its batch cap with runs likely left. */
  capped: boolean
}>

export type SnapshotRunRetention = Readonly<{
  /**
   * The daily retention subject: delete the runs no reader needs, in bounded
   * batches up to the per-run cap.
   */
  sweepSupersededRuns(
    input?: Readonly<{ maxBatches?: number; scope?: ObservationRetentionScope }>,
  ): Promise<SnapshotRunSweep>
}>
