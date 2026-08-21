import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
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
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type RecordScanDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => ScanEventId
  clock: () => Date
  logger: LoggerPort
  outboxRepo?: OutboxRepository
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
      // Idempotent per signed guest session: the public portal records a scan
      // once per session, but a refresh repeats the call and `scanEvents` has
      // no per-session uniqueness — a second insert would inflate the
      // portal.scan metric. The session is portal-scoped (guestSessions.verify
      // binds it to org/property/portal), so the latest scan for this session
      // is this portal's scan whenever one exists.
      const previous = await deps.guestRepo.getLatestScanBySession(
        input.organizationId,
        input.sessionId,
      )
      if (previous?.portalId === input.portalId) return

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
        return
      }
      const scan = scanResult.value
      await deps.guestRepo.recordScan(scan)
      await emitAndRecord(
        deps.events,
        deps.outboxRepo,
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
    }
  }

export type RecordScan = ReturnType<typeof recordScan>
