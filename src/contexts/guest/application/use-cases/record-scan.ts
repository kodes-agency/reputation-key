import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
} from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import { scanRecorded } from '../../domain/events'

export type RecordScanDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => ScanEventId
  clock: () => Date
}>

export type RecordScanInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  sessionId: string
  ipHash: string
}>

export const recordScan =
  (deps: RecordScanDeps) =>
  async (input: RecordScanInput): Promise<void> => {
    try {
      const scanId = deps.idGen()
      const scan = {
        id: scanId,
        ...input,
        createdAt: deps.clock(),
      }
      await deps.guestRepo.recordScan(scan)
      deps.events.emit(
        scanRecorded({
          scanId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          source: input.source,
          occurredAt: scan.createdAt,
        }),
      )
    } catch {
      // Silent failure per I10 — scan is analytics, not critical path
    }
  }

export type RecordScan = ReturnType<typeof recordScan>
