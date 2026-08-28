import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type {
  PeopleCutoverCounts,
  PeopleCutoverEvidence,
  PeopleCutoverScope,
} from '#/shared/release/people-cutover-evidence'

export type PeopleReconcileScope = Readonly<{ organizationIds?: readonly string[] }>

export type PeopleReconcileAnomalyKind =
  | 'property_missing_or_inactive'
  | 'property_tenant_mismatch'
  | 'user_missing'
  | 'portal_missing_or_inactive'
  | 'portal_property_mismatch'
  | 'group_parent_mismatch'

export type PeopleReconcileAnomaly = Readonly<{
  kind: PeopleReconcileAnomalyKind
  organizationId: string
  propertyId: string
  userId: string | null
  sourceId: string
  detail: string
}>

export type PeopleReconcileOrganization = Readonly<{
  organizationId: string
  activeAssignments: number
  participationCandidates: number
  responsibilityCandidates: number
  groupMembershipCandidates: number
  anomalies: number
}>

export type PeopleReconcileReport = Readonly<{
  generatedAt: Date
  organizations: readonly PeopleReconcileOrganization[]
  anomalyRows: readonly PeopleReconcileAnomaly[]
}>

export type PeopleReconcileApplyResult = Readonly<{
  participationsCreated: number
  responsibilitiesCreated: number
  groupMembershipsCreated: number
}>

export type PeopleReconcileParityIssueKind =
  | PeopleReconcileAnomalyKind
  | 'missing_participation'
  | 'missing_portal_responsibility'
  | 'missing_portal_group_membership'

export type PeopleReconcileParityIssue = Readonly<{
  kind: PeopleReconcileParityIssueKind
  organizationId: string
  propertyId: string
  userId: string | null
  sourceId: string
  detail: string
}>

export type PeopleReconcileParity = Readonly<{
  checkedAt: Date
  scope: PeopleCutoverScope
  exact: boolean
  fingerprintSha256: string
  counts: PeopleCutoverCounts
  issueRows: readonly PeopleReconcileParityIssue[]
}>

export type PeopleCutoverPromotionReadiness = Readonly<{
  ready: boolean
  parity: PeopleReconcileParity
  failures: readonly string[]
}>

type LegacyAssignment = Readonly<{
  id: string
  organization_id: string
  property_id: string
  user_id: string
  team_id: string | null
  portal_id: string | null
  created_at: Date | string
  property_org: string | null
  property_deleted_at: Date | string | null
  user_exists: string | null
  user_name: string | null
  portal_org: string | null
  portal_property: string | null
  portal_deleted_at: Date | string | null
}>

type LegacyGroupMembership = Readonly<{
  source_id: string
  organization_id: string
  portal_id: string
  portal_group_id: string
  created_at: Date | string
  portal_org: string | null
  portal_property: string | null
  portal_deleted_at: Date | string | null
  group_org: string | null
  group_property: string | null
  group_deleted_at: Date | string | null
}>

type ParticipationPlan = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  displayName: string
  effectiveFrom: Date
}>

type ResponsibilityPlan = Readonly<{
  participation: ParticipationPlan
  portalId: string
  effectiveFrom: Date
}>

type GroupMembershipPlan = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  portalGroupId: string
  effectiveFrom: Date
}>

type CurrentParticipation = Readonly<{
  organization_id: string
  property_id: string
  user_id: string
}>

type CurrentResponsibility = Readonly<{
  organization_id: string
  property_id: string
  user_id: string
  portal_id: string
  kind: 'primary' | 'supporting'
}>

type CurrentGroupMembership = Readonly<{
  organization_id: string
  property_id: string
  portal_id: string
  portal_group_id: string
}>

type Analysis = Readonly<{
  assignments: readonly LegacyAssignment[]
  participations: readonly ParticipationPlan[]
  responsibilities: readonly ResponsibilityPlan[]
  groupMemberships: readonly GroupMembershipPlan[]
  anomalies: readonly PeopleReconcileAnomaly[]
}>

const asDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value)

function scopeFilter(scope: PeopleReconcileScope | undefined, alias: string) {
  return scope?.organizationIds?.length
    ? sql`AND ${sql.identifier(alias)}.organization_id IN (${sql.join(
        scope.organizationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``
}

async function loadAssignments(
  db: Database,
  scope?: PeopleReconcileScope,
): Promise<readonly LegacyAssignment[]> {
  const rows = await db.execute(sql`
    SELECT sa.id, sa.organization_id, sa.property_id, sa.user_id,
           sa.team_id, sa.portal_id, sa.created_at,
           p.organization_id AS property_org, p.deleted_at AS property_deleted_at,
           u.id AS user_exists, u.name AS user_name,
           po.organization_id AS portal_org, po.property_id AS portal_property,
           po.deleted_at AS portal_deleted_at
    FROM staff_assignments sa
    LEFT JOIN properties p ON p.id = sa.property_id
    LEFT JOIN "user" u ON u.id = sa.user_id
    LEFT JOIN portals po ON po.id = sa.portal_id
    WHERE sa.deleted_at IS NULL
    ${scopeFilter(scope, 'sa')}
    ORDER BY sa.organization_id, sa.property_id, sa.user_id, sa.created_at, sa.id
  `)
  return rows.rows as unknown as readonly LegacyAssignment[]
}

async function loadGroupMemberships(
  db: Database,
  scope?: PeopleReconcileScope,
): Promise<readonly LegacyGroupMembership[]> {
  const rows = await db.execute(sql`
    SELECT pgm.id AS source_id, pgm.organization_id, pgm.portal_id,
           pgm.portal_group_id, pgm.created_at,
           po.organization_id AS portal_org, po.property_id AS portal_property,
           po.deleted_at AS portal_deleted_at,
           pg.organization_id AS group_org, pg.property_id AS group_property,
           pg.deleted_at AS group_deleted_at
    FROM portal_group_members pgm
    LEFT JOIN portals po ON po.id = pgm.portal_id
    LEFT JOIN portal_groups pg ON pg.id = pgm.portal_group_id
    WHERE TRUE
    ${scopeFilter(scope, 'pgm')}
    ORDER BY pgm.organization_id, pgm.portal_id
  `)
  return rows.rows as unknown as readonly LegacyGroupMembership[]
}

const personKey = (organizationId: string, propertyId: string, userId: string) =>
  `${organizationId}\u0000${propertyId}\u0000${userId}`

const responsibilityKey = (
  organizationId: string,
  propertyId: string,
  userId: string,
  portalId: string,
  kind: string,
) => `${personKey(organizationId, propertyId, userId)}\u0000${portalId}\u0000${kind}`

const groupMembershipKey = (
  organizationId: string,
  propertyId: string,
  portalId: string,
  portalGroupId: string,
) => `${organizationId}\u0000${propertyId}\u0000${portalId}\u0000${portalGroupId}`

async function analyze(db: Database, scope?: PeopleReconcileScope): Promise<Analysis> {
  const [assignments, legacyGroups] = await Promise.all([
    loadAssignments(db, scope),
    loadGroupMemberships(db, scope),
  ])
  const anomalies: PeopleReconcileAnomaly[] = []
  const anomalyKeys = new Set<string>()
  const addAnomaly = (anomaly: PeopleReconcileAnomaly) => {
    const key = `${anomaly.kind}:${anomaly.sourceId}`
    if (anomalyKeys.has(key)) return
    anomalyKeys.add(key)
    anomalies.push(anomaly)
  }

  const cleanAssignments: LegacyAssignment[] = []
  for (const row of assignments) {
    const base = {
      organizationId: row.organization_id,
      propertyId: row.property_id,
      userId: row.user_id,
      sourceId: row.id,
    }
    if (row.property_org === null || row.property_deleted_at !== null) {
      addAnomaly({
        ...base,
        kind: 'property_missing_or_inactive',
        detail: 'assignment property is missing or archived',
      })
      continue
    }
    if (row.property_org !== row.organization_id) {
      addAnomaly({
        ...base,
        kind: 'property_tenant_mismatch',
        detail: `property belongs to ${row.property_org}`,
      })
      continue
    }
    if (row.user_exists === null) {
      addAnomaly({ ...base, kind: 'user_missing', detail: 'assignment user is missing' })
      continue
    }
    cleanAssignments.push(row)
  }

  const byPerson = new Map<string, LegacyAssignment[]>()
  for (const row of cleanAssignments) {
    const key = personKey(row.organization_id, row.property_id, row.user_id)
    byPerson.set(key, [...(byPerson.get(key) ?? []), row])
  }
  const participations = [...byPerson.values()].map((rows): ParticipationPlan => {
    const first = rows[0]
    return {
      organizationId: first.organization_id,
      propertyId: first.property_id,
      userId: first.user_id,
      displayName: first.user_name?.trim() || first.user_id,
      effectiveFrom: new Date(
        Math.min(...rows.map((row) => asDate(row.created_at).getTime())),
      ),
    }
  })
  const participationByKey = new Map(
    participations.map((participation) => [
      personKey(
        participation.organizationId,
        participation.propertyId,
        participation.userId,
      ),
      participation,
    ]),
  )

  const responsibilities: ResponsibilityPlan[] = []
  const responsibilityKeys = new Set<string>()
  for (const row of cleanAssignments) {
    if (row.portal_id === null) continue
    const base = {
      organizationId: row.organization_id,
      propertyId: row.property_id,
      userId: row.user_id,
      sourceId: row.id,
    }
    if (row.portal_org === null || row.portal_deleted_at !== null) {
      addAnomaly({
        ...base,
        kind: 'portal_missing_or_inactive',
        detail: 'assignment portal is missing or archived',
      })
      continue
    }
    if (
      row.portal_org !== row.organization_id ||
      row.portal_property !== row.property_id
    ) {
      addAnomaly({
        ...base,
        kind: 'portal_property_mismatch',
        detail: 'assignment portal is outside the organization/property',
      })
      continue
    }
    const participation = participationByKey.get(
      personKey(row.organization_id, row.property_id, row.user_id),
    )!
    const key = `${personKey(row.organization_id, row.property_id, row.user_id)}\u0000${row.portal_id}`
    if (responsibilityKeys.has(key)) continue
    responsibilityKeys.add(key)
    responsibilities.push({
      participation,
      portalId: row.portal_id,
      effectiveFrom: asDate(row.created_at),
    })
  }

  const groupMemberships: GroupMembershipPlan[] = []
  for (const row of legacyGroups) {
    if (
      row.portal_org === null ||
      row.portal_property === null ||
      row.group_property === null ||
      row.group_org === null ||
      row.portal_deleted_at !== null ||
      row.group_deleted_at !== null ||
      row.organization_id !== row.portal_org ||
      row.organization_id !== row.group_org ||
      row.portal_property !== row.group_property
    ) {
      addAnomaly({
        kind: 'group_parent_mismatch',
        organizationId: row.organization_id,
        propertyId: row.portal_property ?? row.group_property ?? 'unknown',
        userId: null,
        sourceId: row.source_id,
        detail:
          'legacy portal/group membership has missing, archived, or cross-property parents',
      })
      continue
    }
    groupMemberships.push({
      organizationId: row.organization_id,
      propertyId: row.portal_property,
      portalId: row.portal_id,
      portalGroupId: row.portal_group_id,
      effectiveFrom: asDate(row.created_at),
    })
  }

  return {
    assignments,
    participations,
    responsibilities,
    groupMemberships,
    anomalies,
  }
}

export async function buildPeopleReconcileReport(
  db: Database,
  clock: Clock,
  scope?: PeopleReconcileScope,
): Promise<PeopleReconcileReport> {
  const analysis = await analyze(db, scope)
  const orgIds = new Set([
    ...analysis.assignments.map((row) => row.organization_id),
    ...analysis.groupMemberships.map((row) => row.organizationId),
    ...analysis.anomalies.map((row) => row.organizationId),
  ])
  const organizations = [...orgIds]
    .map((organizationId): PeopleReconcileOrganization => ({
      organizationId,
      activeAssignments: analysis.assignments.filter(
        (row) => row.organization_id === organizationId,
      ).length,
      participationCandidates: analysis.participations.filter(
        (row) => row.organizationId === organizationId,
      ).length,
      responsibilityCandidates: analysis.responsibilities.filter(
        (row) => row.participation.organizationId === organizationId,
      ).length,
      groupMembershipCandidates: analysis.groupMemberships.filter(
        (row) => row.organizationId === organizationId,
      ).length,
      anomalies: analysis.anomalies.filter((row) => row.organizationId === organizationId)
        .length,
    }))
    .sort((a, b) => a.organizationId.localeCompare(b.organizationId))
  return { generatedAt: clock(), organizations, anomalyRows: analysis.anomalies }
}

function normalizedScope(scope?: PeopleReconcileScope): PeopleCutoverScope {
  const organizationIds = [...new Set(scope?.organizationIds ?? [])].sort()
  return organizationIds.length === 0
    ? { kind: 'global', organizationIds: [] }
    : { kind: 'organizations', organizationIds }
}

async function loadCurrentPeopleMappings(
  db: Database,
  scope?: PeopleReconcileScope,
): Promise<
  Readonly<{
    participations: readonly CurrentParticipation[]
    responsibilities: readonly CurrentResponsibility[]
    groupMemberships: readonly CurrentGroupMembership[]
  }>
> {
  const [participations, responsibilities, groupMemberships] = await Promise.all([
    db.execute(sql`
        SELECT sp.organization_id, sp.property_id, sul.user_id
        FROM staff_participations sp
        JOIN staff_user_links sul
          ON sul.organization_id = sp.organization_id
         AND sul.staff_participant_id = sp.staff_participant_id
         AND sul.effective_to IS NULL
        WHERE sp.status = 'active'
        ${scopeFilter(scope, 'sp')}
      `),
    db.execute(sql`
        SELECT pr.organization_id, pr.property_id, sul.user_id, pr.portal_id, pr.kind
        FROM portal_responsibilities pr
        JOIN staff_participations sp
          ON sp.organization_id = pr.organization_id
         AND sp.property_id = pr.property_id
         AND sp.id = pr.staff_participation_id
        JOIN staff_user_links sul
          ON sul.organization_id = sp.organization_id
         AND sul.staff_participant_id = sp.staff_participant_id
         AND sul.effective_to IS NULL
        WHERE pr.effective_to IS NULL AND sp.status = 'active'
        ${scopeFilter(scope, 'pr')}
      `),
    db.execute(sql`
        SELECT pgm.organization_id, pgm.property_id, pgm.portal_id,
               pgm.portal_group_id
        FROM portal_group_memberships pgm
        WHERE pgm.effective_to IS NULL
        ${scopeFilter(scope, 'pgm')}
      `),
  ])

  return {
    participations: participations.rows as unknown as readonly CurrentParticipation[],
    responsibilities:
      responsibilities.rows as unknown as readonly CurrentResponsibility[],
    groupMemberships:
      groupMemberships.rows as unknown as readonly CurrentGroupMembership[],
  }
}

function parityFingerprint(analysis: Analysis, scope: PeopleCutoverScope): string {
  const compareJson = (left: unknown, right: unknown): number => {
    const leftJson = JSON.stringify(left)
    const rightJson = JSON.stringify(right)
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0
  }
  const stable = {
    version: 'repkey-people-parity-2',
    scope,
    legacyAssignments: analysis.assignments
      .map((row) => [
        row.id,
        row.organization_id,
        row.property_id,
        row.user_id,
        row.team_id,
        row.portal_id,
      ])
      .sort(compareJson),
    participations: analysis.participations
      .map((row) => personKey(row.organizationId, row.propertyId, row.userId))
      .sort(),
    responsibilities: analysis.responsibilities
      .map((row) =>
        responsibilityKey(
          row.participation.organizationId,
          row.participation.propertyId,
          row.participation.userId,
          row.portalId,
          'supporting',
        ),
      )
      .sort(),
    groupMemberships: analysis.groupMemberships
      .map((row) =>
        groupMembershipKey(
          row.organizationId,
          row.propertyId,
          row.portalId,
          row.portalGroupId,
        ),
      )
      .sort(),
    anomalies: analysis.anomalies
      .map((row) => [row.kind, row.sourceId])
      .sort(compareJson),
  }
  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex')
}

/**
 * Compare every approved legacy relationship with the canonical effective-dated
 * model. Retained Team relationships are deliberately excluded: ADR 0052 makes
 * them quarantine evidence, not a mapping target. Extra canonical rows are
 * allowed; missing approved mappings and every legacy anomaly fail the gate.
 */
export async function verifyPeopleReconciliationParity(
  db: Database,
  clock: Clock,
  scope?: PeopleReconcileScope,
): Promise<PeopleReconcileParity> {
  const [analysis, current] = await Promise.all([
    analyze(db, scope),
    loadCurrentPeopleMappings(db, scope),
  ])
  const issueRows: PeopleReconcileParityIssue[] = [...analysis.anomalies]
  const participationKeys = new Set(
    current.participations.map((row) =>
      personKey(row.organization_id, row.property_id, row.user_id),
    ),
  )
  const responsibilityKeys = new Set(
    current.responsibilities.map((row) =>
      responsibilityKey(
        row.organization_id,
        row.property_id,
        row.user_id,
        row.portal_id,
        row.kind,
      ),
    ),
  )
  const groupMembershipKeys = new Set(
    current.groupMemberships.map((row) =>
      groupMembershipKey(
        row.organization_id,
        row.property_id,
        row.portal_id,
        row.portal_group_id,
      ),
    ),
  )

  let matchedParticipations = 0
  for (const expected of analysis.participations) {
    const key = personKey(expected.organizationId, expected.propertyId, expected.userId)
    if (participationKeys.has(key)) {
      matchedParticipations += 1
      continue
    }
    issueRows.push({
      kind: 'missing_participation',
      organizationId: expected.organizationId,
      propertyId: expected.propertyId,
      userId: expected.userId,
      sourceId: key,
      detail: 'clean legacy person has no active Staff participation',
    })
  }

  let matchedResponsibilities = 0
  for (const expected of analysis.responsibilities) {
    const key = responsibilityKey(
      expected.participation.organizationId,
      expected.participation.propertyId,
      expected.participation.userId,
      expected.portalId,
      'supporting',
    )
    if (responsibilityKeys.has(key)) {
      matchedResponsibilities += 1
      continue
    }
    issueRows.push({
      kind: 'missing_portal_responsibility',
      organizationId: expected.participation.organizationId,
      propertyId: expected.participation.propertyId,
      userId: expected.participation.userId,
      sourceId: key,
      detail: 'clean legacy Portal assignment has no active supporting responsibility',
    })
  }

  let matchedGroupMemberships = 0
  for (const expected of analysis.groupMemberships) {
    const key = groupMembershipKey(
      expected.organizationId,
      expected.propertyId,
      expected.portalId,
      expected.portalGroupId,
    )
    if (groupMembershipKeys.has(key)) {
      matchedGroupMemberships += 1
      continue
    }
    issueRows.push({
      kind: 'missing_portal_group_membership',
      organizationId: expected.organizationId,
      propertyId: expected.propertyId,
      userId: null,
      sourceId: key,
      detail: 'clean legacy Portal Group relationship has no active effective interval',
    })
  }

  const missingMappings = issueRows.length - analysis.anomalies.length
  const counts: PeopleCutoverCounts = {
    legacyAssignments: analysis.assignments.length,
    expectedParticipations: analysis.participations.length,
    matchedParticipations,
    expectedResponsibilities: analysis.responsibilities.length,
    matchedResponsibilities,
    expectedGroupMemberships: analysis.groupMemberships.length,
    matchedGroupMemberships,
    anomalies: analysis.anomalies.length,
    missingMappings,
  }
  const parityScope = normalizedScope(scope)
  return {
    checkedAt: clock(),
    scope: parityScope,
    exact: issueRows.length === 0,
    fingerprintSha256: parityFingerprint(analysis, parityScope),
    counts,
    issueRows,
  }
}

/**
 * Promotion requires both current global parity and the exact artifact emitted
 * by an allowed operator invocation. The live fingerprint makes stale files
 * harmless; the policy audit makes an untraceable hand-authored file fail.
 */
export async function verifyPeopleCutoverPromotionReadiness(
  db: Database,
  clock: Clock,
  evidence: PeopleCutoverEvidence,
  scope?: PeopleReconcileScope,
): Promise<PeopleCutoverPromotionReadiness> {
  const parity = await verifyPeopleReconciliationParity(db, clock, scope)
  const failures: string[] = []
  if (!parity.exact) {
    failures.push(
      ...parity.issueRows.map(
        (row) =>
          `${row.kind}: org=${row.organizationId} property=${row.propertyId} source=${row.sourceId}`,
      ),
    )
  }
  if (JSON.stringify(evidence.scope) !== JSON.stringify(parity.scope)) {
    failures.push(
      'people cutover evidence scope does not match the requested database scope',
    )
  }
  if (evidence.fingerprintSha256 !== parity.fingerprintSha256) {
    failures.push(
      'people cutover evidence fingerprint does not match current database state',
    )
  }
  const countFields = Object.keys(evidence.counts) as (keyof PeopleCutoverCounts)[]
  if (countFields.some((field) => evidence.counts[field] !== parity.counts[field])) {
    failures.push('people cutover evidence counts do not match current database parity')
  }

  const audit = await db.execute(sql`
    SELECT occurred_at
    FROM policy_decision_audit
    WHERE correlation_id = ${evidence.operator.correlationId}
      AND actor_type = 'operator'
      AND actor_id = ${evidence.operator.id}
      AND action = 'system:ops'
      AND execution_kind = 'operator'
      AND decision = 'allow'
      AND reason NOT IN ('read', 'dry-run')
      AND occurred_at >= ${new Date(new Date(evidence.checkedAt).getTime() - 15 * 60_000)}
      AND occurred_at <= ${new Date(new Date(evidence.checkedAt).getTime() + 15 * 60_000)}
    LIMIT 1
  `)
  if (audit.rows.length === 0) {
    failures.push('people cutover evidence has no matching audited operator decision')
  }

  return { ready: failures.length === 0, parity, failures }
}

export async function applyPeopleReconciliation(
  db: Database,
  _report: PeopleReconcileReport,
  options: Readonly<{ createdBy: string; scope?: PeopleReconcileScope }>,
): Promise<PeopleReconcileApplyResult> {
  // Always re-read and reclassify under the apply transaction boundary; a
  // reviewed report is evidence, never trusted mutation input.
  const analysis = await analyze(db, options.scope)
  return db.transaction(async (tx) => {
    const result = {
      participationsCreated: 0,
      responsibilitiesCreated: 0,
      groupMembershipsCreated: 0,
    }
    const participationIds = new Map<string, string>()
    for (const plan of analysis.participations) {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${`${plan.organizationId}:${plan.userId}`})
        )
      `)
      let participant = await tx.execute(sql`
        SELECT sp.id
        FROM staff_participants sp
        JOIN staff_user_links sul
          ON sul.organization_id = sp.organization_id
         AND sul.staff_participant_id = sp.id
         AND sul.effective_to IS NULL
        WHERE sp.organization_id = ${plan.organizationId}
          AND sul.user_id = ${plan.userId}
          AND sp.status = 'active'
        LIMIT 1
      `)
      let participantId = (participant.rows[0] as { id?: string } | undefined)?.id
      if (!participantId) {
        participant = await tx.execute(sql`
          INSERT INTO staff_participants
            (organization_id, display_name, status, created_by, created_at, updated_at)
          VALUES (
            ${plan.organizationId}, ${plan.displayName}, 'active',
            ${options.createdBy}, ${plan.effectiveFrom}, ${plan.effectiveFrom}
          )
          RETURNING id
        `)
        participantId = (participant.rows[0] as { id?: string } | undefined)?.id
        if (!participantId) continue
        await tx.execute(sql`
          INSERT INTO staff_user_links
            (organization_id, staff_participant_id, user_id, effective_from, created_by)
          VALUES (
            ${plan.organizationId}, ${participantId}, ${plan.userId},
            ${plan.effectiveFrom}, ${options.createdBy}
          )
        `)
      }
      const inserted = await tx.execute(sql`
        INSERT INTO staff_participations
          (organization_id, property_id, staff_participant_id, user_id,
           display_name, status,
           started_at, created_by, created_at, updated_at)
        VALUES (
          ${plan.organizationId}, ${plan.propertyId}, ${participantId}, NULL,
          ${plan.displayName}, 'active', ${plan.effectiveFrom},
          ${options.createdBy}, ${plan.effectiveFrom}, ${plan.effectiveFrom}
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `)
      result.participationsCreated += inserted.rows.length
      const existing = await tx.execute(sql`
        SELECT id FROM staff_participations
        WHERE organization_id = ${plan.organizationId}
          AND property_id = ${plan.propertyId}
          AND staff_participant_id = ${participantId}
          AND status = 'active'
        LIMIT 1
      `)
      const id = (existing.rows[0] as { id?: string } | undefined)?.id
      if (id) {
        participationIds.set(
          personKey(plan.organizationId, plan.propertyId, plan.userId),
          id,
        )
      }
    }

    for (const plan of analysis.responsibilities) {
      const participationId = participationIds.get(
        personKey(
          plan.participation.organizationId,
          plan.participation.propertyId,
          plan.participation.userId,
        ),
      )
      if (!participationId) continue
      const inserted = await tx.execute(sql`
        INSERT INTO portal_responsibilities
          (organization_id, property_id, portal_id, staff_participation_id,
           kind, effective_from, created_by)
        SELECT
          ${plan.participation.organizationId}, ${plan.participation.propertyId},
          ${plan.portalId}, ${participationId}, 'supporting',
          ${plan.effectiveFrom}, ${options.createdBy}
        WHERE NOT EXISTS (
          SELECT 1 FROM portal_responsibilities pr
          WHERE pr.organization_id = ${plan.participation.organizationId}
            AND pr.property_id = ${plan.participation.propertyId}
            AND pr.portal_id = ${plan.portalId}
            AND pr.staff_participation_id = ${participationId}
            AND pr.kind = 'supporting'
            AND pr.effective_to IS NULL
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `)
      result.responsibilitiesCreated += inserted.rows.length
    }

    for (const plan of analysis.groupMemberships) {
      const inserted = await tx.execute(sql`
        INSERT INTO portal_group_memberships
          (organization_id, property_id, portal_id, portal_group_id,
           effective_from, created_by)
        SELECT
          ${plan.organizationId}, ${plan.propertyId}, ${plan.portalId},
          ${plan.portalGroupId}, ${plan.effectiveFrom}, ${options.createdBy}
        WHERE NOT EXISTS (
          SELECT 1 FROM portal_group_memberships pgm
          WHERE pgm.organization_id = ${plan.organizationId}
            AND pgm.portal_id = ${plan.portalId}
            AND pgm.effective_to IS NULL
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `)
      result.groupMembershipsCreated += inserted.rows.length
    }
    return result
  })
}
