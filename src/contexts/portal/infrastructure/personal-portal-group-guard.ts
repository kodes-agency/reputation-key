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
    throw portalError('personal_portal_goal_locked', 'End the goal first.')
  const skipped = await tx.execute(sql`SELECT a.id FROM goal_subject_assignments a
    JOIN goal_programs g ON g.organization_id = a.organization_id AND g.property_id = a.property_id AND g.id = a.program_id
    JOIN portals incoming ON incoming.organization_id = a.organization_id AND incoming.id = ${scope.portalId}::uuid
    WHERE a.organization_id = ${scope.organizationId} AND a.property_id = ${scope.propertyId}::uuid AND a.portal_group_id = ${scope.portalGroupId}::uuid
      AND a.metric_key = 'qualified_scans' AND g.status <> 'ended' AND (a.effective_to IS NULL OR a.effective_to > ${scope.at})
      AND (incoming.kind = 'personal' OR EXISTS (SELECT 1 FROM portal_group_memberships m JOIN portals p ON p.organization_id = m.organization_id AND p.id = m.portal_id WHERE m.organization_id = a.organization_id AND m.portal_group_id = a.portal_group_id AND m.effective_to IS NULL AND p.kind = 'personal'))
      AND (incoming.skip_private_rating OR EXISTS (SELECT 1 FROM portal_group_memberships m JOIN portals p ON p.organization_id = m.organization_id AND p.id = m.portal_id WHERE m.organization_id = a.organization_id AND m.portal_group_id = a.portal_group_id AND m.effective_to IS NULL AND p.skip_private_rating)) LIMIT 1`)
  if (skipped.rows.length)
    throw portalError(
      'personal_portal_goal_locked',
      'This portal has a running scan target for staff. End the target first.',
    )
}
