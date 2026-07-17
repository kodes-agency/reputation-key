// Inbox context — inbox repository port
// Per architecture: "Repository ports for all data access."

import type {
  InboxItem,
  InboxItemDetail,
  InboxStatus,
  SourceType,
} from '../../domain/types'
import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

export type Cursor = Readonly<{
  sourceDate: Date
  id: InboxItemId
}>

export type InboxFilters = Readonly<{
  propertyId?: PropertyId
  propertyIds?: ReadonlyArray<PropertyId>
  status?: InboxStatus | ReadonlyArray<InboxStatus>
  isEscalated?: boolean
  sourceType?: SourceType
  platform?: string
  ratingMin?: number
  ratingMax?: number
  sourceDateFrom?: Date
  sourceDateTo?: Date
  q?: string
}>

export type PaginatedResult = Readonly<{
  items: ReadonlyArray<InboxItem>
  nextCursor: Cursor | null
}>

export type InboxRepository = Readonly<{
  findById(id: InboxItemId, orgId: OrganizationId): Promise<InboxItem | null>
  findByIds(
    ids: ReadonlyArray<InboxItemId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyArray<InboxItem>>
  findBySource(
    sourceType: SourceType,
    sourceId: string,
    orgId: OrganizationId,
  ): Promise<InboxItem | null>
  findFilteredPaginated(
    filters: InboxFilters,
    orgId: OrganizationId,
    cursor?: Cursor,
    limit?: number,
  ): Promise<PaginatedResult>
  create(item: InboxItem, orgId: OrganizationId): Promise<InboxItem>
  updateStatus(
    id: InboxItemId,
    orgId: OrganizationId,
    status: InboxStatus,
    timestampFields: Partial<Record<string, Date>>,
    now?: Date,
  ): Promise<InboxItem>
  bulkUpdateStatus(
    ids: ReadonlyArray<InboxItemId>,
    orgId: OrganizationId,
    status: InboxStatus,
    timestampFields: Partial<Record<string, Date>>,
    now?: Date,
  ): Promise<{ updated: number }>
  updateAssignment(
    id: InboxItemId,
    orgId: OrganizationId,
    assignedTo: UserId | null,
    now?: Date,
  ): Promise<InboxItem>
  countByStatus(
    orgId: OrganizationId,
    status: InboxStatus,
    propertyIds?: ReadonlyArray<PropertyId>,
  ): Promise<number>
  setEscalation(
    id: InboxItemId,
    orgId: OrganizationId,
    escalatedBy: UserId,
    now?: Date,
  ): Promise<InboxItem>
  resolveEscalation(
    id: InboxItemId,
    orgId: OrganizationId,
    resolvedBy: UserId,
    now?: Date,
  ): Promise<InboxItem>
  /** Count items with an active escalation flag (isEscalated AND not yet resolved). */
  countEscalatedActive(
    orgId: OrganizationId,
    propertyIds?: ReadonlyArray<PropertyId>,
  ): Promise<number>
  /** Count `open` items created after `since` (null since = all open). */
  countOpenSince(
    orgId: OrganizationId,
    since: Date | null,
    propertyIds?: ReadonlyArray<PropertyId>,
  ): Promise<number>
  findDetailById(id: InboxItemId, orgId: OrganizationId): Promise<InboxItemDetail | null>
}>
