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
  create(item: InboxItem): Promise<InboxItem>
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
  countByStatus(orgId: OrganizationId, status: InboxStatus): Promise<number>
  syncDenormalizedFields(
    id: InboxItemId,
    orgId: OrganizationId,
    fields: { rating?: number; snippet?: string; sourceDate?: Date },
    now?: Date,
  ): Promise<void>
  findDetailById(id: InboxItemId, orgId: OrganizationId): Promise<InboxItemDetail | null>
}>
