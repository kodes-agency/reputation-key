import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { lockStaffTargetProperty } from '#/shared/db/staff-target-lock'
import { portalError } from '../domain/errors'

/** A later Group move must not turn an ordinary rating target into a staff target. */
export async function assertPersonalGroupTarget(
  tx: Tx,
  scope: Readonly<{
    organizationId: string
    propertyId: string
    portalId: string
    portalGroupId: string
    at: Date
  }>,
): Promise<void> {
  await lockStaffTargetProperty(tx, scope.organizationId, scope.propertyId)
  const result = await tx.execute(sql`SELECT a.id FROM goal_subject_assignments a
    JOIN goal_programs g ON g.organization_id = a.organization_id AND g.property_id = a.property_id AND g.id = a.program_id
    JOIN portals p ON p.organization_id = a.organization_id AND p.property_id = a.property_id AND p.id = ${scope.portalId}::uuid
    WHERE a.organization_id = ${scope.organizationId} AND a.property_id = ${scope.propertyId}::uuid AND a.portal_group_id = ${scope.portalGroupId}::uuid
      AND p.kind = 'personal' AND a.metric_key <> 'qualified_scans' AND g.status <> 'ended'
      AND (a.effective_to IS NULL OR a.effective_to > ${scope.at}) LIMIT 1`)
  if (result.rows.length)
    throw portalError(
      'personal_portal_goal_locked',
      'End this Group rating target before adding a personal Portal. Staff targets can count scans only',
    )
}
