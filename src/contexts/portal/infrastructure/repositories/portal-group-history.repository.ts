// Portal context — Portal Group history Drizzle reader.
// Reads the ledger the command store writes. Every query filters by
// organization_id; the ledger has no deleted_at, because nothing in it is
// deleted while its group exists.

import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalGroupHistory } from '#/shared/db/schema/portal-group.schema'
import { trace } from '#/shared/observability/trace'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  unbrand,
} from '#/shared/domain/ids'
import type { PortalGroupHistoryRepository } from '../../application/ports/portal-group-history.repository'
import {
  PORTAL_GROUP_HISTORY_KINDS,
  type PortalGroupHistoryEntry,
} from '../../domain/portal-group-history'

type HistoryRow = typeof portalGroupHistory.$inferSelect

const kindOf = (value: string): PortalGroupHistoryEntry['kind'] => {
  const kind = PORTAL_GROUP_HISTORY_KINDS.find((candidate) => candidate === value)
  if (!kind) throw new Error(`unknown Portal Group history kind: ${value}`)
  return kind
}

const entryFromRow = (row: HistoryRow): PortalGroupHistoryEntry => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  portalGroupId: portalGroupId(row.portalGroupId),
  kind: kindOf(row.kind),
  portalId: row.portalId === null ? null : portalId(row.portalId),
  otherGroupId: row.otherGroupId === null ? null : portalGroupId(row.otherGroupId),
  name: row.name,
  previousName: row.previousName,
  actorUserId: row.actorUserId,
  occurredAt: row.occurredAt,
})

export const createPortalGroupHistoryRepository = (
  db: Database,
): PortalGroupHistoryRepository => ({
  listForGroup: async (orgId, groupId, limit) =>
    trace('portalGroupHistory.listForGroup', async () => {
      const rows = await db
        .select()
        .from(portalGroupHistory)
        .where(
          and(
            eq(portalGroupHistory.organizationId, unbrand(orgId)),
            eq(portalGroupHistory.portalGroupId, unbrand(groupId)),
          ),
        )
        .orderBy(
          desc(portalGroupHistory.occurredAt),
          // Entries that share an instant come from one command. The only command
          // that writes several to a group is its creation, which is the oldest.
          asc(sql`(${portalGroupHistory.kind} = 'created')`),
          desc(portalGroupHistory.id),
        )
        .limit(limit)
      return rows.map(entryFromRow)
    }),
})
