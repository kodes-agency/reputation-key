import type { GuestObservationStore } from '../ports/guest-observation-store.port'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
} from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { guestScanRecorded } from '../../domain/events'
import { buildScanEvent } from '../../domain/constructors'

export type RecordScanDeps = Readonly<{
  observationStore: GuestObservationStore
  idGen: () => ScanEventId
  clock: () => Date
  logger: LoggerPort
}>

export type RecordScanInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  sessionId: string
  ipHash: string
}>

export type RecordScanOutcome = 'applied' | 'duplicate' | 'failed'

export const recordScan =
  (deps: RecordScanDeps) =>
  async (input: RecordScanInput): Promise<RecordScanOutcome> => {
    try {
      const scanId = deps.idGen()
      // Validate via domain constructor
      const scanResult = buildScanEvent({
        id: scanId,
        ...input,
        now: deps.clock(),
      })
      if (scanResult.isErr()) {
        deps.logger.warn(
          { err: scanResult.error },
          'Scan event construction failed — suppressed per I10',
        )
        return 'failed'
      }
      const scan = scanResult.value
      return await deps.observationStore.commitScan(
        scan,
        guestScanRecorded({
          scanId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          source: input.source,
          occurredAt: scan.createdAt,
        }),
      )
    } catch (e) {
      // Silent failure per I10 — scan is analytics, not critical path
      deps.logger.warn({ err: e }, 'Scan recording failed — suppressed per I10')
      return 'failed'
    }
  }

export type RecordScan = ReturnType<typeof recordScan>
