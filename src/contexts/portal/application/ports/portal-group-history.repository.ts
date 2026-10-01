// Portal context — Portal Group history reader.
// The ledger is written only by the command store, in the transaction of the
// change it describes; this port reads it. Every method takes organizationId
// first (tenant isolation).

import type { OrganizationId, PortalGroupId } from '#/shared/domain/ids'
import type { PortalGroupHistoryEntry } from '../../domain/portal-group-history'

export type PortalGroupHistoryRepository = Readonly<{
  /** Newest first. `limit` caps the page; the ledger is never truncated. */
  listForGroup: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
    limit: number,
  ) => Promise<ReadonlyArray<PortalGroupHistoryEntry>>
}>
