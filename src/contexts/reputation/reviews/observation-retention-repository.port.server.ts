import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

/**
 * Retention of Review source observations (ADR 0055, note 2026-10-24 (b)).
 * Counts and Review ids only: no Review text, rating or reviewer crosses it.
 */

/** Every Organization, or one: an operator's first apply, and test isolation. */
export type ObservationRetentionScope = Readonly<{ organizationId?: OrganizationId }>

export type ObservationRepeatBatchInput = Readonly<{
  /** The previous batch's last Review; null for the first batch. */
  after: ReviewId | null
  limit: number
  scope?: ObservationRetentionScope
}>

export type ObservationRepeatBatch = Readonly<{
  /** Reviews in the batch; 0 when no Review is left after the cursor. */
  reviews: number
  /** Observation rows those Reviews held before the batch ran. */
  observations: number
  /** Repeats found (scan) or deleted (prune). */
  repeats: number
  /** The batch's last Review, the cursor for the next call; null when empty. */
  last: ReviewId | null
}>

export type SupersededCopySweep = Readonly<{
  batches: number
  processed: number
  /** True when the run stopped at its batch cap with rows likely left. */
  capped: boolean
}>

export type ObservationRetention = Readonly<{
  /** Count the repeats of the next batch of Reviews. Reads only. */
  scanRepeats(input: ObservationRepeatBatchInput): Promise<ObservationRepeatBatch>
  /** Delete the repeats of the next batch of Reviews, in one statement. */
  pruneRepeats(input: ObservationRepeatBatchInput): Promise<ObservationRepeatBatch>
  /** Blank one batch of superseded copies whose clock has passed. */
  redactExpiredSupersededCopies(
    input: Readonly<{ limit: number; scope?: ObservationRetentionScope }>,
  ): Promise<number>
  /** The daily retention subject: batches of redaction up to the per-run cap. */
  sweepExpiredSupersededCopies(
    input: Readonly<{
      batchSize: number
      maxBatches?: number
      scope?: ObservationRetentionScope
    }>,
  ): Promise<SupersededCopySweep>
}>
