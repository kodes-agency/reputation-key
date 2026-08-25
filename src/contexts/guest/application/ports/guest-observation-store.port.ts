import type { GuestReviewLinkClicked, GuestScanRecorded } from '../../domain/events'
import type { GuestDestinationAction, ScanEvent } from '../../domain/types'

export type GuestObservationStore = Readonly<{
  /** Atomic, session-deduplicated scan row + durable fact. */
  commitScan(scan: ScanEvent, fact: GuestScanRecorded): Promise<'applied' | 'duplicate'>
  /** Atomic short-lived dedupe receipt + canonical content-free action fact. */
  commitReviewLinkClick(
    action: GuestDestinationAction,
    fact: GuestReviewLinkClicked,
  ): Promise<'applied' | 'duplicate'>
}>
