import type { GuestReviewLinkClicked, GuestScanRecorded } from '../../domain/events'
import type { ScanEvent } from '../../domain/types'

export type GuestObservationStore = Readonly<{
  /** Atomic, session-deduplicated scan row + durable fact. */
  commitScan(scan: ScanEvent, fact: GuestScanRecorded): Promise<'applied' | 'duplicate'>
  /** The outbox row is the canonical first-party link-action observation. */
  commitReviewLinkClick(fact: GuestReviewLinkClicked): Promise<'applied'>
}>
