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
  for (const assignment of assignments) {
    const subject = assignment.subject
    if (subject.kind === 'property') continue
    const portalIds = subject.kind === 'portal' ? [subject.portalId] : []
    const groupIds = subject.kind === 'portal_group' ? [subject.portalGroupId] : []
    const result =
      await tx.execute(sql`SELECT p.kind, p.skip_private_rating FROM portals p
      WHERE p.organization_id = ${version.organizationId} AND p.property_id = ${version.propertyId}::uuid
        AND (p.id IN (${ids(portalIds)}) OR EXISTS (SELECT 1 FROM portal_group_memberships m
          WHERE m.organization_id = p.organization_id AND m.property_id = p.property_id AND m.portal_id = p.id
            AND m.portal_group_id IN (${ids(groupIds)}) AND (m.effective_to IS NULL OR m.effective_to > ${version.effectiveFrom})))`)
    if (!result.rows.some((row) => row.kind === 'personal')) continue
    if (version.metric !== 'qualified_scans')
      throw new GoalProgramError('staff_scan_only')
    if (result.rows.some((row) => row.skip_private_rating))
      throw new GoalProgramError('staff_private_ratings_skipped')
  }
}
