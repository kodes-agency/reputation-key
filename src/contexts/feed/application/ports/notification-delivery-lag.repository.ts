export const MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT = 1000

export type NotificationDeliveryLagWindow = Readonly<{
  /** Inclusive lower bound keeps the operational read finite. */
  recordedAtOrAfter: Date
  /** Exclusive grace edge; fresher asynchronous work is not yet late. */
  recordedBefore: Date
  /** Per-stage saturation bound. */
  scanLimit: number
}>

/** The scope a queued notification email would be delivered under. */
export type EmailDeliveryScope = Readonly<{
  organizationId: string
  /** Null only for Organization-scoped mandatory notices. */
  propertyId: string | null
}>

/**
 * The current `notification.send_email` decision for one scope. Composition
 * supplies it: the capability store is process policy that Feed does not read.
 */
export type IsEmailDeliveryAllowed = (scope: EmailDeliveryScope) => boolean

/**
 * Provider-acceptance evidence for scopes where email may be sent now. Rows of
 * a capability-dark scope (not allowlisted, suspended, killed) stay pending by
 * design — nothing will ever attempt them — so they are not late mail.
 */
export type ImmediateEmailAcceptanceReport = Readonly<{
  /** Sendable immediate rows that have not received provider acceptance. */
  awaitingProviderAcceptance: number
  /** Awaiting rows for which a provider attempt has already begun. */
  attemptedAwaitingProviderAcceptance: number
  /** Durable-source clock for the oldest linked awaiting row. */
  oldestAwaitingSourceRecordedAt: Date | null
  /** Exact p99 for this window, or null when the bounded sample saturated. */
  acceptedLatencyP99Ms: number | null
  /** Accepted rows included in the p99 calculation. */
  acceptedSampleCount: number
  /** Active immediate rows whose event id does not resolve to an active source fact. */
  sourceUnlinked: number
  /**
   * True when more sendable rows existed than this bounded read could
   * evaluate. The bound counts sendable rows only: a dark backlog neither
   * saturates it nor crowds sendable rows out of it.
   */
  saturated: boolean
}>

export type NotificationDeliveryLagReport = Readonly<{
  /** Durable source facts whose base consumer receipt is still absent. */
  sourceReceiptPending: number
  /** Redis-accepted deliveries without their atomic Postgres materialization receipt. */
  materializationPending: number
  oldestSourceRecordedAt: Date | null
  /** Durable-source clock for end-to-end in-app latency. */
  oldestMaterializationSourceRecordedAt: Date | null
  /** Redis acceptance clock for isolating the Redis→Postgres stage. */
  oldestMaterializationEnqueuedAt: Date | null
  sourceSaturated: boolean
  materializationSaturated: boolean
  /** Source-clock evidence for the five-minute immediate-email acceptance target. */
  immediateEmailAcceptance: ImmediateEmailAcceptanceReport
}>

export type NotificationDeliveryLagRepository = Readonly<{
  /** Bounded, payload-free operational evidence for the two delivery stages. */
  read(window: NotificationDeliveryLagWindow): Promise<NotificationDeliveryLagReport>
}>
