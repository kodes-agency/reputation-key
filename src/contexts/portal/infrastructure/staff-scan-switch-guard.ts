import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { lockStaffTargetProperty } from '#/shared/db/staff-target-lock'
import type { UpdatePortalCommand } from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
/** Shares the Goal/membership fence, so a concurrent target cannot slip past the switch. */
export async function assertStaffScanSwitch(
  tx: Tx,
  command: UpdatePortalCommand,
): Promise<void> {
  if (command.patch.skipPrivateRating !== true) return
  await lockStaffTargetProperty(tx, command.organizationId, command.propertyId)
  const result = await tx.execute(sql`SELECT a.id FROM goal_subject_assignments a
    JOIN goal_programs g ON g.organization_id = a.organization_id AND g.id = a.program_id
    JOIN portals current ON current.organization_id = a.organization_id AND current.id = ${command.portalId}::uuid
    WHERE a.organization_id = ${command.organizationId} AND a.property_id = ${command.propertyId}::uuid
      AND g.status <> 'ended' AND a.metric_key = 'qualified_scans' AND (a.effective_to IS NULL OR a.effective_to > ${command.revision})
      AND ((a.portal_id = current.id AND current.kind = 'personal') OR EXISTS (
        SELECT 1 FROM portal_group_memberships own WHERE own.organization_id = a.organization_id AND own.portal_id = current.id AND own.portal_group_id = a.portal_group_id AND own.effective_to IS NULL
          AND EXISTS (SELECT 1 FROM portal_group_memberships m JOIN portals p ON p.organization_id = m.organization_id AND p.id = m.portal_id WHERE m.organization_id = own.organization_id AND m.portal_group_id = own.portal_group_id AND m.effective_to IS NULL AND p.kind = 'personal')))
      LIMIT 1`)
  if (result.rows.length)
    throw portalError(
      'running_rating_goal',
      'This portal has a running scan target for staff. End the target first.',
    )
}
