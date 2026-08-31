import type {
  GuestQualifiedScanRecorded,
  GuestQualifiedScanRetracted,
  GuestReviewLinkClicked,
  GuestScanRecorded,
} from '../../domain/events'
import type { GuestDestinationAction, QualifiedScan, ScanEvent } from '../../domain/types'

export type GuestObservationStore = Readonly<{
  /** Atomic, session-deduplicated scan row + durable fact. */
  commitScan(scan: ScanEvent, fact: GuestScanRecorded): Promise<'applied' | 'duplicate'>
  /** Atomic rolling-24h receipt, identifier-only source truth, and durable fact. */
  commitQualifiedScan(
    scan: QualifiedScan,
    sessionId: string,
    fact: GuestQualifiedScanRecorded,
  ): Promise<'applied' | 'duplicate'>
  /** Append-only correction fact for one previously committed Qualified Scan. */
  retractQualifiedScan(
    fact: GuestQualifiedScanRetracted,
  ): Promise<'applied' | 'duplicate'>
  /** Atomic short-lived dedupe receipt + canonical content-free action fact. */
  commitReviewLinkClick(
    action: GuestDestinationAction,
    fact: GuestReviewLinkClicked,
  ): Promise<'applied' | 'duplicate'>
}>
