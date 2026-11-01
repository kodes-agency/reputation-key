import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { lockStaffTargetProperty } from '#/shared/db/staff-target-lock'
import type {
  GoalSubjectAssignment,
  GoalProgramVersion,
} from '../../application/ports/goal-program.repository'
import { GoalProgramError } from '../../application/use-cases/goal-program-shared'

const ids = (values: readonly string[]) =>
  values.length
    ? sql.join(
        values.map((id) => sql`${id}::uuid`),
        sql`, `,
      )
    : sql`NULL::uuid`

/** Rechecks the subject after the shared membership/definition fence is held. */
export async function assertPersonalGoalAssignments(
  tx: Tx,
  version: GoalProgramVersion,
  assignments: readonly GoalSubjectAssignment[],
): Promise<void> {
  await lockStaffTargetProperty(tx, version.organizationId, version.propertyId)
  if (version.metric === 'qualified_scans') return
  const portalIds = assignments.flatMap((a) =>
    a.subject.kind === 'portal' ? [a.subject.portalId] : [],
  )
  const groupIds = assignments.flatMap((a) =>
    a.subject.kind === 'portal_group' ? [a.subject.portalGroupId] : [],
  )
  if (!portalIds.length && !groupIds.length) return
  const result = await tx.execute(sql`SELECT p.id FROM portals p
    WHERE p.organization_id = ${version.organizationId} AND p.property_id = ${version.propertyId}::uuid AND p.kind = 'personal'
      AND (p.id IN (${ids(portalIds)}) OR EXISTS (SELECT 1 FROM portal_group_memberships m
        WHERE m.organization_id = p.organization_id AND m.property_id = p.property_id AND m.portal_id = p.id
          AND m.portal_group_id IN (${ids(groupIds)}) AND (m.effective_to IS NULL OR m.effective_to > ${version.effectiveFrom}))) LIMIT 1`)
  if (result.rows.length) throw new GoalProgramError('invalid_subject')
}
