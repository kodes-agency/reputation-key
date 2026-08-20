// Review context — new-review discovery repository port.
//
// The refresh sweep (BQC-1.5) can only ever revisit reviews ALREADY stored,
// so a connected property with no stored review — or one whose newest review
// is nowhere near its 30-day content TTL — is never polled again after the
// import one-shot. This port is the discovery side of that gap: it selects
// CONNECTED, ACTIVE properties whose next poll is due and records the
// per-property due time so a slow or failing property cannot starve the rest.
//
// Content-free: identifiers, timestamps, and an error class only.

export type ReviewDiscoveryCandidate = Readonly<{
  propertyId: string
  organizationId: string
  connectionId: string
  /** Canonical GBP resource name: `accounts/{account}/locations/{location}`. */
  locationName: string
}>

export type ReviewDiscoveryRepository = Readonly<{
  /**
   * Keyset-paged batch of Google-connected, active, non-deleted properties
   * whose discovery poll is due at `due` (never polled, or next-due elapsed).
   *
   * Ordered by property id ASC; `cursor` is the last id of the previous
   * batch (exclusive). The strict `id > cursor` predicate never skips or
   * repeats as the cursor advances.
   */
  findDuePropertiesBatch(
    due: Date,
    cursor: string | null,
    limit: number,
  ): Promise<readonly ReviewDiscoveryCandidate[]>

  /**
   * A sync job was enqueued for this property: clear the error state and
   * push the next poll to `nextDueAt`.
   */
  markDiscoveryScheduled(
    propertyId: string,
    now: Date,
    nextDueAt: Date,
  ): Promise<void>

  /**
   * The enqueue failed for this property: record the error class and defer
   * the next poll to `nextDueAt`. Deferring on failure is what keeps one
   * broken property from consuming every batch of every subsequent run.
   */
  markDiscoveryDeferred(
    propertyId: string,
    now: Date,
    nextDueAt: Date,
    errorClass: string,
  ): Promise<void>
}>
