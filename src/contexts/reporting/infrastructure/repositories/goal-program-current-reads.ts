import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  goalMonthlyResults,
  goalMonthTargetChanges,
  goalPrograms,
  goalProgramVersions,
  goalResultRevisions,
  goalSubjectAssignments,
} from '#/shared/db/schema/goal.schema'
import type {
  GoalProgramBundle,
  GoalProgramCurrentReads,
} from '../../application/ports/goal-program.repository'
import { mapAssignment, mapProgram, mapResult, mapVersion } from './goal-program.rows'
import { mapTargetChange } from './goal-month-target.repository'

type ProgramRow = typeof goalPrograms.$inferSelect

async function readGoalTargetProvenance(
  db: Pick<Database, 'execute'>,
  versions: readonly (typeof goalProgramVersions.$inferSelect)[],
): Promise<NonNullable<GoalProgramBundle['targetProvenance']>> {
  if (versions.length === 0) return {}
  const provenance = (
    await db.execute(
      sql.join(
        versions.map(
          (version) => sql`
    (WITH run AS (
      SELECT candidate.* FROM goal_program_versions AS candidate
      WHERE candidate.organization_id = ${version.organizationId}
        AND candidate.property_id = ${version.propertyId}::uuid
        AND candidate.program_id = ${version.programId}::uuid
        AND candidate.version <= ${version.version}
        AND candidate.version > coalesce((SELECT max(changed.version)
          FROM goal_program_versions AS changed
          WHERE changed.program_id = candidate.program_id AND changed.version < ${version.version}
            AND (changed.metric_key <> ${version.metricKey} OR changed.target_value <> ${version.targetValue})), 0)
    )
    SELECT ${version.id}::text AS id, first.created_at AS set_at, first.created_by AS set_by,
      coalesce((SELECT min(first_month.period_start) FROM goal_subject_assignments AS assignment
        CROSS JOIN LATERAL (
          SELECT period_start FROM goal_monthly_results WHERE assignment_id = assignment.id
          ORDER BY period_start LIMIT 1
        ) AS first_month
        WHERE assignment.organization_id = ${version.organizationId}
          AND assignment.property_id = ${version.propertyId}::uuid
          AND assignment.program_id = ${version.programId}::uuid
          AND assignment.program_version_id IN (SELECT id FROM run)),
        (SELECT min(effective_from) FROM run WHERE effective_to IS NULL OR effective_to > effective_from), ${version.effectiveFrom}::timestamptz) AS counts_from
    FROM (SELECT * FROM run ORDER BY version LIMIT 1) AS first)
  `,
        ),
        sql` UNION ALL `,
      ),
    )
  ).rows
  return Object.fromEntries(
    provenance.map((row) => [
      String(row['id']),
      {
        setAt: new Date(row['set_at'] as string),
        setBy: String(row['set_by']),
        countsFrom: new Date(row['counts_from'] as string),
      },
    ]),
  )
}

/** Current assignments and their last months; the ledger's size does not affect this read. */
export async function hydrateCurrentGoalPrograms(
  db: Pick<Database, 'select' | 'selectDistinctOn' | 'execute'>,
  programs: readonly ProgramRow[],
  months = 2,
): Promise<readonly GoalProgramBundle[]> {
  if (programs.length === 0) return []
  const heads = sql.join(
    programs.map((p) => sql`(${p.id}::uuid, ${p.currentVersion}::int)`),
    sql`, `,
  )
  const programIds = programs.map((p) => p.id)
  const organizationIds = [...new Set(programs.map((p) => p.organizationId))]
  const settledClass = sql`(${goalMonthlyResults.status} = 'closed')`
  const historyTips = await db
    .selectDistinctOn([goalMonthlyResults.programId, settledClass])
    .from(goalMonthlyResults)
    .where(
      and(
        inArray(goalMonthlyResults.organizationId, organizationIds),
        inArray(goalMonthlyResults.programId, programIds),
      ),
    )
    .orderBy(
      asc(goalMonthlyResults.programId),
      settledClass,
      desc(goalMonthlyResults.periodStart),
      desc(goalMonthlyResults.id),
    )
  const assignments = await db
    .select()
    .from(goalSubjectAssignments)
    .where(
      and(
        inArray(goalSubjectAssignments.organizationId, organizationIds),
        inArray(goalSubjectAssignments.programId, programIds),
        or(
          historyTips.length
            ? inArray(
                goalSubjectAssignments.id,
                historyTips.map((row) => row.assignmentId),
              )
            : undefined,
          sql`EXISTS (SELECT 1 FROM goal_program_versions AS version
      WHERE version.id = ${goalSubjectAssignments.programVersionId}
        AND ((version.program_id, version.version) IN (${heads})
          OR (${months > 1} AND ${goalSubjectAssignments.id} IN (
            SELECT DISTINCT ON (history.subject_kind, history.property_subject_id, history.portal_group_id, history.portal_id) history.id
            FROM goal_subject_assignments AS history
            WHERE history.organization_id = ${goalSubjectAssignments.organizationId}
              AND history.property_id = ${goalSubjectAssignments.propertyId}
              AND history.program_id = ${goalSubjectAssignments.programId}
            ORDER BY history.subject_kind, history.property_subject_id, history.portal_group_id, history.portal_id,
              history.effective_from DESC, history.created_at DESC, history.id DESC
          ))
          OR (version.version = (SELECT max(previous.version) FROM goal_program_versions AS previous
            JOIN goal_programs AS head ON head.id = previous.program_id
            WHERE previous.program_id = version.program_id AND previous.version < head.current_version
              AND previous.effective_to > previous.effective_from))))`,
        ),
      ),
    )
    .orderBy(asc(goalSubjectAssignments.createdAt), asc(goalSubjectAssignments.id))
  const recentResults =
    assignments.length === 0
      ? []
      : await db
          .select()
          .from(goalMonthlyResults)
          .where(
            and(
              inArray(goalMonthlyResults.organizationId, organizationIds),
              sql`${goalMonthlyResults.id} IN (
              SELECT latest.id FROM (VALUES ${sql.join(
                assignments.map((a) => sql`(${a.id}::uuid)`),
                sql`, `,
              )}) AS assignment(id)
              CROSS JOIN LATERAL (
                SELECT id FROM goal_monthly_results
                WHERE assignment_id = assignment.id
                ORDER BY period_start DESC, id DESC LIMIT ${months}
              ) AS latest
            )`,
            ),
          )
          .orderBy(asc(goalMonthlyResults.periodStart), asc(goalMonthlyResults.id))
  const results = [
    ...new Map([...recentResults, ...historyTips].map((row) => [row.id, row])).values(),
  ].sort(
    (a, b) =>
      a.periodStart.getTime() - b.periodStart.getTime() || a.id.localeCompare(b.id),
  )
  const pinned = [
    ...new Set([
      ...assignments.map((a) => a.programVersionId),
      ...results.map((r) => r.programVersionId),
    ]),
  ]
  const versions = await db
    .select()
    .from(goalProgramVersions)
    .where(
      and(
        inArray(goalProgramVersions.organizationId, organizationIds),
        or(
          sql`(${goalProgramVersions.programId}, ${goalProgramVersions.version}) IN (${heads})`,
          pinned.length ? inArray(goalProgramVersions.id, pinned) : undefined,
        ),
      ),
    )
    .orderBy(asc(goalProgramVersions.version))
  const revisions =
    results.length === 0 || months === 1
      ? []
      : await db
          .selectDistinctOn([goalResultRevisions.monthlyResultId])
          .from(goalResultRevisions)
          .where(
            and(
              inArray(goalResultRevisions.organizationId, organizationIds),
              inArray(
                goalResultRevisions.monthlyResultId,
                results.map((r) => r.id),
              ),
            ),
          )
          .orderBy(
            asc(goalResultRevisions.monthlyResultId),
            desc(goalResultRevisions.revision),
          )
  const changes =
    results.length === 0 || months === 1
      ? []
      : await db
          .select()
          .from(goalMonthTargetChanges)
          .where(
            and(
              or(
                ...programs.map((program) =>
                  and(
                    eq(goalMonthTargetChanges.organizationId, program.organizationId),
                    eq(goalMonthTargetChanges.propertyId, program.propertyId),
                    eq(goalMonthTargetChanges.programId, program.id),
                  ),
                ),
              ),
              inArray(
                goalMonthTargetChanges.monthlyResultId,
                results.map((r) => r.id),
              ),
            ),
          )
          .orderBy(
            asc(goalMonthTargetChanges.createdAt),
            asc(goalMonthTargetChanges.changeId),
            asc(goalMonthTargetChanges.monthlyResultId),
          )
  const provenanceByVersion =
    months === 1 ? {} : await readGoalTargetProvenance(db, versions)
  return programs.flatMap((program) => {
    const version = versions.find(
      (v) => v.programId === program.id && v.version === program.currentVersion,
    )
    if (!version) return []
    return [
      {
        program: mapProgram(program),
        version: mapVersion(version),
        versions: versions.filter((v) => v.programId === program.id).map(mapVersion),
        assignments: assignments
          .filter((a) => a.programId === program.id)
          .map(mapAssignment),
        results: results
          .filter((r) => r.programId === program.id)
          .map((r) =>
            mapResult(
              r,
              revisions.find((rev) => rev.monthlyResultId === r.id),
            ),
          ),
        ...(months === 1
          ? {}
          : {
              targetProvenance: Object.fromEntries(
                versions
                  .filter((v) => v.programId === program.id)
                  .map((v) => [v.id, provenanceByVersion[v.id]!]),
              ),
              targetChanges: changes
                .filter((c) => c.programId === program.id)
                .map(mapTargetChange),
            }),
      },
    ]
  })
}

export function createGoalProgramCurrentReads(db: Database): GoalProgramCurrentReads {
  const scope = (organizationId: string, propertyId: string, programId?: string) =>
    and(
      eq(goalPrograms.organizationId, organizationId),
      eq(goalPrograms.propertyId, propertyId),
      programId ? eq(goalPrograms.id, programId) : undefined,
    )
  return {
    async getHistory(organizationId, propertyId, programId) {
      const [program] = await db
        .select()
        .from(goalPrograms)
        .where(scope(organizationId, propertyId, programId))
        .limit(1)
      if (!program) return null
      const versions = await db
        .select()
        .from(goalProgramVersions)
        .where(
          and(
            eq(goalProgramVersions.organizationId, organizationId),
            eq(goalProgramVersions.propertyId, propertyId),
            eq(goalProgramVersions.programId, programId),
          ),
        )
        .orderBy(asc(goalProgramVersions.version))
      const version = versions.find((v) => v.version === program.currentVersion)
      if (!version) return null
      const assignments = await db
        .select()
        .from(goalSubjectAssignments)
        .where(
          and(
            eq(goalSubjectAssignments.organizationId, organizationId),
            eq(goalSubjectAssignments.propertyId, propertyId),
            eq(goalSubjectAssignments.programId, programId),
          ),
        )
        .orderBy(asc(goalSubjectAssignments.createdAt), asc(goalSubjectAssignments.id))
      const results: GoalProgramBundle['results'][number][] = []
      const targetChanges: NonNullable<GoalProgramBundle['targetChanges']>[number][] = []
      let after: { periodStart: Date; id: string } | undefined
      do {
        const page = await createGoalProgramCurrentReads(db).listHistory(
          organizationId,
          propertyId,
          programId,
          { after, includeProvenance: false },
        )
        results.push(...page.results)
        targetChanges.push(...page.targetChanges)
        after = page.next ?? undefined
      } while (after)
      return {
        program: mapProgram(program),
        version: mapVersion(version),
        versions: versions.map(mapVersion),
        assignments: assignments.map(mapAssignment),
        results: results.sort(
          (a, b) =>
            a.periodStart.getTime() - b.periodStart.getTime() || a.id.localeCompare(b.id),
        ),
        targetChanges: targetChanges.sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.changeId.localeCompare(b.changeId) ||
            a.monthlyResultId.localeCompare(b.monthlyResultId),
        ),
      }
    },
    async getSummary(organizationId, propertyId, programId) {
      const rows = await db
        .select()
        .from(goalPrograms)
        .where(scope(organizationId, propertyId, programId))
        .limit(1)
      return (await hydrateCurrentGoalPrograms(db, rows))[0] ?? null
    },
    async listSummaries(organizationId, propertyId) {
      const rows = await db
        .select()
        .from(goalPrograms)
        .where(scope(organizationId, propertyId))
        .orderBy(asc(goalPrograms.name), asc(goalPrograms.id))
      return hydrateCurrentGoalPrograms(db, rows)
    },
    async listHistory(organizationId, propertyId, programId, input = {}) {
      const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 100)))
      const pageIds = await db.execute(sql`
          SELECT latest.id FROM goal_subject_assignments AS assignment
          CROSS JOIN LATERAL (
            SELECT id, period_start FROM goal_monthly_results AS month
            WHERE month.assignment_id = assignment.id
              AND month.organization_id = ${organizationId}
              AND month.property_id = ${propertyId}::uuid
              ${input.after ? sql`AND (month.period_start, month.id) < (${input.after.periodStart}, ${input.after.id}::uuid)` : sql``}
            ORDER BY month.period_start DESC, month.id DESC LIMIT ${limit + 1}
          ) AS latest
          WHERE assignment.organization_id = ${organizationId}
            AND assignment.property_id = ${propertyId}::uuid
            AND assignment.program_id = ${programId}::uuid
          ORDER BY latest.period_start DESC, latest.id DESC LIMIT ${limit + 1}
      `)
      const idsToRead = pageIds.rows.map((row) => String(row['id']))
      const rows =
        idsToRead.length === 0
          ? []
          : await db
              .select()
              .from(goalMonthlyResults)
              .where(
                and(
                  eq(goalMonthlyResults.organizationId, organizationId),
                  eq(goalMonthlyResults.propertyId, propertyId),
                  eq(goalMonthlyResults.programId, programId),
                  inArray(goalMonthlyResults.id, idsToRead),
                ),
              )
              .orderBy(desc(goalMonthlyResults.periodStart), desc(goalMonthlyResults.id))
      const selected = rows.slice(0, limit)
      const ids = selected.map((row) => row.id)
      const versions = selected.length
        ? await db
            .select()
            .from(goalProgramVersions)
            .where(
              and(
                eq(goalProgramVersions.organizationId, organizationId),
                eq(goalProgramVersions.propertyId, propertyId),
                inArray(goalProgramVersions.id, [
                  ...new Set(selected.map((r) => r.programVersionId)),
                ]),
              ),
            )
        : []
      const assignments = selected.length
        ? await db
            .select()
            .from(goalSubjectAssignments)
            .where(
              and(
                eq(goalSubjectAssignments.organizationId, organizationId),
                eq(goalSubjectAssignments.propertyId, propertyId),
                inArray(goalSubjectAssignments.id, [
                  ...new Set(selected.map((r) => r.assignmentId)),
                ]),
              ),
            )
        : []
      const revisions = ids.length
        ? await db
            .selectDistinctOn([goalResultRevisions.monthlyResultId])
            .from(goalResultRevisions)
            .where(
              and(
                eq(goalResultRevisions.organizationId, organizationId),
                eq(goalResultRevisions.propertyId, propertyId),
                inArray(goalResultRevisions.monthlyResultId, ids),
              ),
            )
            .orderBy(
              asc(goalResultRevisions.monthlyResultId),
              desc(goalResultRevisions.revision),
            )
        : []
      const changes = ids.length
        ? await db
            .select()
            .from(goalMonthTargetChanges)
            .where(
              and(
                eq(goalMonthTargetChanges.organizationId, organizationId),
                eq(goalMonthTargetChanges.propertyId, propertyId),
                inArray(goalMonthTargetChanges.monthlyResultId, ids),
              ),
            )
            .orderBy(
              asc(goalMonthTargetChanges.createdAt),
              asc(goalMonthTargetChanges.changeId),
              asc(goalMonthTargetChanges.monthlyResultId),
            )
        : []
      const last = selected.at(-1)
      return {
        results: selected.map((r) =>
          mapResult(
            r,
            revisions.find((rev) => rev.monthlyResultId === r.id),
          ),
        ),
        versions: versions.map(mapVersion),
        assignments: assignments.map(mapAssignment),
        targetChanges: changes.map(mapTargetChange),
        ...(input.includeProvenance === false || versions.length === 0
          ? {}
          : { targetProvenance: await readGoalTargetProvenance(db, versions) }),
        next:
          rows.length > limit && last
            ? { periodStart: last.periodStart, id: last.id }
            : null,
      }
    },
  }
}
