/**
 * True best-effort Guest observations whose failure is intentionally kept
 * off the public journey's critical path. Private ratings are deliberately
 * absent: their canonical fact and outbox row commit atomically or the
 * command fails for an honest retry.
 */
export type GuestObservationLossKind = 'scan' | 'review_link'

export type GuestObservationLossRecord = Readonly<{
  kind: GuestObservationLossKind
  occurredAt: Date
}>

export type GuestObservationLossSnapshot = Readonly<{
  monitorAvailable: boolean
  windowMs: number
  precisionMs: number
  scanLossCount: number
  reviewLinkLossCount: number
  /** Always zero: rating persistence is durable command work, not best-effort analytics. */
  ratingLossCount: 0
  totalLossCount: number
  ratingDisposition: 'not_applicable_durable'
}>

export type GuestObservationLossMonitor = Readonly<{
  record(input: GuestObservationLossRecord): Promise<void>
  read(asOf: Date): Promise<GuestObservationLossSnapshot>
}>

export type GuestObservationLossReportOutcome = 'recorded' | 'monitor_unavailable'

export type GuestObservationLossReporter = (
  kind: GuestObservationLossKind,
) => Promise<GuestObservationLossReportOutcome>
