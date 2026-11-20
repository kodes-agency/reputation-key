import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  OperationalAction,
  OperationalActionRecord,
  OperationalActionResourceType,
} from '../domain/operational-action-history'

export type OperationalActionHistoryEntry = OperationalActionRecord &
  Readonly<{
    sequence: number
    actorRedactedAt: Date | null
    resourceRedactedAt: Date | null
  }>

export type OperationalActionHistoryCursor = Readonly<{
  occurredAt: Date
  sequence: number
}>

export type OperationalActionHistoryQuery = Readonly<{
  organizationId: OrganizationId
  propertyId?: PropertyId
  action?: OperationalAction
  resourceType?: OperationalActionResourceType
  cursor?: OperationalActionHistoryCursor
  limit: number
  observedAt: Date
}>

export type OperationalActionHistoryPage = Readonly<{
  items: readonly OperationalActionHistoryEntry[]
  nextCursor: OperationalActionHistoryCursor | null
}>

export type OperationalActionHistoryReadinessSnapshot = Readonly<{
  lastSequence: number
  coveredSequenceCount: number
  duplicateSequenceCount: number
  minimumSequence: number | null
  maximumSequence: number | null
  oldestRecordAt: Date | null
  newestRecordAt: Date | null
  activeLegalHoldCount: number
}>

export type OperationalActionHistoryRetentionAssessment = Readonly<{
  eligibleCount: number
  heldCount: number
  oldestEligibleAt: Date | null
}>

export type OperationalActionHistoryLegalHold = Readonly<{
  id: string
  organizationId: OrganizationId
  reasonCode: string
  protectsFrom: Date
  protectsThrough: Date | null
  placedAt: Date
  placedByActorId: string
}>

export type OperationalActionHistoryStore = Readonly<{
  append(
    record: OperationalActionRecord,
  ): Promise<Readonly<{ status: 'appended' | 'duplicate'; sequence: number }>>
  readWithAccess(
    input: Readonly<{
      query: OperationalActionHistoryQuery
      accessRecord: OperationalActionRecord
    }>,
  ): Promise<OperationalActionHistoryPage>
  readReadiness(
    organizationId: OrganizationId,
  ): Promise<OperationalActionHistoryReadinessSnapshot>
  assessRetention(
    input: Readonly<{
      organizationId: OrganizationId
      cutoff: Date
      assessmentRecord: OperationalActionRecord
    }>,
  ): Promise<OperationalActionHistoryRetentionAssessment>
  placeLegalHold(
    input: Readonly<{
      hold: OperationalActionHistoryLegalHold
      actionRecord: OperationalActionRecord
    }>,
  ): Promise<Readonly<{ status: 'placed' | 'duplicate'; holdId: string }>>
  releaseLegalHold(
    input: Readonly<{
      organizationId: OrganizationId
      holdId: string
      releasedAt: Date
      releasedByActorId: string
      reasonCode: string
      actionRecord: OperationalActionRecord
    }>,
  ): Promise<'released' | 'duplicate'>
  redactSubject(
    input: Readonly<{
      organizationId: OrganizationId
      subjectType: 'actor' | 'resource'
      subjectId: string
      reasonCode: string
      redactedAt: Date
      limit: number
      actionRecord: OperationalActionRecord
    }>,
  ): Promise<
    Readonly<{
      status: 'applied' | 'duplicate'
      redacted: number
      held: number
      complete: boolean
    }>
  >
}>

export type OperationalActionHistoryDeliveryStore = Readonly<{
  applyOnce(
    input: Readonly<{
      record: OperationalActionRecord
      eventId: string
      consumerName: string
    }>,
  ): Promise<'applied' | 'duplicate'>
}>
