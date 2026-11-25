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
