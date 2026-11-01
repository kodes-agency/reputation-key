import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, portalId, portalGroupId } from '#/shared/domain/ids'
import {
  propertyWallClockAt,
  propertyWallClockToInstant,
} from '#/shared/domain/property-calendar'
import type {
  GovernedGoalMetricQuery,
  GovernedGoalMetricResult,
} from '../../application/use-cases/query-goal-metric'
import type { StaffResultsScope } from '../../application/ports/staff-results-reader.port'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

export const createStaffGoalsReader =
  (
    db: Database,
    clock: () => Date,
    query: (input: GovernedGoalMetricQuery) => Promise<GovernedGoalMetricResult>,
  ) =>
  async (scope: StaffResultsScope) => {
    const now = clock()
    const programs =
      await db.execute(sql`SELECT p.id, CASE WHEN a.portal_id IS NOT NULL THEN 'Your goal' ELSE g.name END AS name, v.id AS version_id, v.property_timezone AS timezone, COALESCE(month.target_value, v.target_value)::float8 AS target,
    a.subject_kind, a.portal_id, a.portal_group_id
    FROM goal_programs p JOIN goal_program_versions v ON v.program_id = p.id AND v.organization_id = p.organization_id
    JOIN goal_subject_assignments a ON a.program_version_id = v.id AND a.organization_id = v.organization_id
    LEFT JOIN portal_groups g ON g.organization_id = a.organization_id AND g.property_id = p.property_id AND g.id = a.portal_group_id
    LEFT JOIN goal_monthly_results month ON month.assignment_id = a.id AND month.organization_id = p.organization_id AND month.period_start <= ${now} AND month.period_end > ${now}
    WHERE p.organization_id = ${scope.organizationId} AND p.property_id = ${scope.propertyId}::uuid AND p.status = 'active' AND v.metric_key = 'qualified_scans' AND v.metric_definition_version_id = ${METRIC_VERSION_IDS.qualifiedScanGoal}::uuid
      AND v.effective_from <= ${now} AND (v.effective_to IS NULL OR v.effective_to > ${now}) AND a.effective_from <= ${now} AND (a.effective_to IS NULL OR a.effective_to > ${now})
      AND (a.portal_id = ${scope.portalId}::uuid OR (a.portal_group_id = ${scope.groupId}::uuid AND (
        EXISTS (SELECT 1 FROM staff_property_settings setting WHERE setting.organization_id = p.organization_id AND setting.property_id = p.property_id AND setting.colleague_list_enabled)
        OR (SELECT count(DISTINCT membership.portal_id) FROM portal_group_memberships membership JOIN portals personal ON personal.organization_id = membership.organization_id AND personal.property_id = membership.property_id AND personal.id = membership.portal_id
          WHERE membership.organization_id = p.organization_id AND membership.property_id = p.property_id AND membership.portal_group_id = a.portal_group_id AND membership.effective_from <= ${now} AND (membership.effective_to IS NULL OR membership.effective_to > ${now}) AND personal.kind = 'personal' AND personal.deleted_at IS NULL AND personal.publication_state <> 'archived') >= 3
      ))) ORDER BY p.name, p.id`)
    const rows = await Promise.all(
      programs.rows.map(async (row) => {
        const timezone = String(row.timezone)
        const wall = propertyWallClockAt(now, timezone)
        const first = { ...wall, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }
        const monthAfter =
          wall.month === 12
            ? { year: wall.year + 1, month: 1 }
            : { year: wall.year, month: wall.month + 1 }
        const result = await query({
          organizationId: organizationId(scope.organizationId),
          propertyId: propertyId(scope.propertyId),
          definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
          subject: row.portal_id
            ? { kind: 'portal', portalId: portalId(String(row.portal_id)) }
            : {
                kind: 'portal_group',
                portalGroupId: portalGroupId(String(row.portal_group_id)),
              },
          periodStart: propertyWallClockToInstant(first, timezone),
          periodEnd: propertyWallClockToInstant({ ...first, ...monthAfter }, timezone),
        })
        return result.exactValue === null
          ? null
          : {
              id: String(row.id),
              name: String(row.name),
              target: Number(row.target),
              scans: result.exactValue,
            }
      }),
    )
    return rows.filter((row) => row !== null)
  }
