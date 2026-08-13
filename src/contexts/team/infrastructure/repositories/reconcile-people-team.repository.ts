import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type PeopleReconcileScope = Readonly<{ organizationIds?: readonly string[] }>

export type PeopleReconcileAnomalyKind =
  | 'property_missing_or_inactive'
  | 'property_tenant_mismatch'
  | 'user_missing'
  | 'team_missing_or_inactive'
  | 'team_property_mismatch'
  | 'multiple_active_teams'
  | 'portal_missing_or_inactive'
  | 'portal_property_mismatch'
  | 'lead_without_participation'
  | 'lead_team_conflict'
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
  membershipCandidates: number
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
  membershipsCreated: number
  leadsPromoted: number
  responsibilitiesCreated: number
  groupMembershipsCreated: number
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
  team_org: string | null
  team_property: string | null
  team_deleted_at: Date | string | null
  portal_org: string | null
  portal_property: string | null
  portal_deleted_at: Date | string | null
}>

type LegacyLead = Readonly<{
  team_id: string
  organization_id: string
  property_id: string
  team_lead_id: string
  team_created_at: Date | string
  user_exists: string | null
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

type MembershipPlan = Readonly<{
  participation: ParticipationPlan
  teamId: string
  role: 'member' | 'lead'
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

type Analysis = Readonly<{
  assignments: readonly LegacyAssignment[]
  participations: readonly ParticipationPlan[]
  memberships: readonly MembershipPlan[]
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
           t.organization_id AS team_org, t.property_id AS team_property,
           t.deleted_at AS team_deleted_at,
           po.organization_id AS portal_org, po.property_id AS portal_property,
           po.deleted_at AS portal_deleted_at
    FROM staff_assignments sa
    LEFT JOIN properties p ON p.id = sa.property_id
    LEFT JOIN "user" u ON u.id = sa.user_id
    LEFT JOIN teams t ON t.id = sa.team_id
    LEFT JOIN portals po ON po.id = sa.portal_id
    WHERE sa.deleted_at IS NULL
    ${scopeFilter(scope, 'sa')}
    ORDER BY sa.organization_id, sa.property_id, sa.user_id, sa.created_at, sa.id
  `)
  return rows.rows as unknown as readonly LegacyAssignment[]
}

async function loadLeads(
  db: Database,
  scope?: PeopleReconcileScope,
): Promise<readonly LegacyLead[]> {
  const rows = await db.execute(sql`
    SELECT t.id AS team_id, t.organization_id, t.property_id,
           t.team_lead_id, t.created_at AS team_created_at,
           u.id AS user_exists
    FROM teams t
    LEFT JOIN "user" u ON u.id = t.team_lead_id
    WHERE t.deleted_at IS NULL AND t.team_lead_id IS NOT NULL
    ${scopeFilter(scope, 't')}
    ORDER BY t.organization_id, t.property_id, t.id
  `)
  return rows.rows as unknown as readonly LegacyLead[]
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

async function analyze(db: Database, scope?: PeopleReconcileScope): Promise<Analysis> {
  const [assignments, leads, legacyGroups] = await Promise.all([
    loadAssignments(db, scope),
    loadLeads(db, scope),
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

  const membershipByPerson = new Map<string, MembershipPlan>()
  for (const [key, rows] of byPerson) {
    const teamRows = rows.filter((row) => row.team_id !== null)
    const valid = teamRows.filter((row) => {
      const base = {
        organizationId: row.organization_id,
        propertyId: row.property_id,
        userId: row.user_id,
        sourceId: row.id,
      }
      if (row.team_org === null || row.team_deleted_at !== null) {
        addAnomaly({
          ...base,
          kind: 'team_missing_or_inactive',
          detail: 'assignment team is missing or archived',
        })
        return false
      }
      if (row.team_org !== row.organization_id || row.team_property !== row.property_id) {
        addAnomaly({
          ...base,
          kind: 'team_property_mismatch',
          detail: 'assignment team is outside the organization/property',
        })
        return false
      }
      return true
    })
    const teamIds = [...new Set(valid.map((row) => row.team_id as string))]
    if (teamIds.length > 1) {
      const first = rows[0]
      addAnomaly({
        kind: 'multiple_active_teams',
        organizationId: first.organization_id,
        propertyId: first.property_id,
        userId: first.user_id,
        sourceId: key,
        detail: `active assignments name multiple teams: ${teamIds.join(', ')}`,
      })
      continue
    }
    if (teamIds.length === 1) {
      const participation = participationByKey.get(key)!
      membershipByPerson.set(key, {
        participation,
        teamId: teamIds[0],
        role: 'member',
        effectiveFrom: new Date(
          Math.min(
            ...valid
              .filter((row) => row.team_id === teamIds[0])
              .map((row) => asDate(row.created_at).getTime()),
          ),
        ),
      })
    }
  }

  for (const lead of leads) {
    const key = personKey(lead.organization_id, lead.property_id, lead.team_lead_id)
    const participation = participationByKey.get(key)
    if (!participation || lead.user_exists === null) {
      addAnomaly({
        kind: 'lead_without_participation',
        organizationId: lead.organization_id,
        propertyId: lead.property_id,
        userId: lead.team_lead_id,
        sourceId: lead.team_id,
        detail: 'legacy lead has no clean active property participation',
      })
      continue
    }
    const existing = membershipByPerson.get(key)
    if (existing && existing.teamId !== lead.team_id) {
      addAnomaly({
        kind: 'lead_team_conflict',
        organizationId: lead.organization_id,
        propertyId: lead.property_id,
        userId: lead.team_lead_id,
        sourceId: lead.team_id,
        detail: `lead assignment points to team ${existing.teamId}`,
      })
      membershipByPerson.delete(key)
      continue
    }
    membershipByPerson.set(key, {
      participation,
      teamId: lead.team_id,
      role: 'lead',
      effectiveFrom: new Date(
        Math.max(
          participation.effectiveFrom.getTime(),
          asDate(lead.team_created_at).getTime(),
        ),
      ),
    })
  }

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
    memberships: [...membershipByPerson.values()],
    responsibilities,
    groupMemberships,
    anomalies,
  }
}

export async function buildPeopleReconcileReport(
  db: Database,
  scope?: PeopleReconcileScope,
): Promise<PeopleReconcileReport> {
  const analysis = await analyze(db, scope)
  const orgIds = new Set([
    ...analysis.assignments.map((row) => row.organization_id),
    ...analysis.groupMemberships.map((row) => row.organizationId),
    ...analysis.anomalies.map((row) => row.organizationId),
  ])
  const organizations = [...orgIds]
    .map(
      (organizationId): PeopleReconcileOrganization => ({
        organizationId,
        activeAssignments: analysis.assignments.filter(
          (row) => row.organization_id === organizationId,
        ).length,
        participationCandidates: analysis.participations.filter(
          (row) => row.organizationId === organizationId,
        ).length,
        membershipCandidates: analysis.memberships.filter(
          (row) => row.participation.organizationId === organizationId,
        ).length,
        responsibilityCandidates: analysis.responsibilities.filter(
          (row) => row.participation.organizationId === organizationId,
        ).length,
        groupMembershipCandidates: analysis.groupMemberships.filter(
          (row) => row.organizationId === organizationId,
        ).length,
        anomalies: analysis.anomalies.filter(
          (row) => row.organizationId === organizationId,
        ).length,
      }),
    )
    .sort((a, b) => a.organizationId.localeCompare(b.organizationId))
  return { generatedAt: new Date(), organizations, anomalyRows: analysis.anomalies }
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
      membershipsCreated: 0,
      leadsPromoted: 0,
      responsibilitiesCreated: 0,
      groupMembershipsCreated: 0,
    }
    const participationIds = new Map<string, string>()
    for (const plan of analysis.participations) {
      const inserted = await tx.execute(sql`
        INSERT INTO staff_participations
          (organization_id, property_id, user_id, display_name, status,
           started_at, created_by, created_at, updated_at)
        VALUES (
          ${plan.organizationId}, ${plan.propertyId}, ${plan.userId},
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
          AND user_id = ${plan.userId}
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

    for (const plan of analysis.memberships) {
      const key = personKey(
        plan.participation.organizationId,
        plan.participation.propertyId,
        plan.participation.userId,
      )
      const participationId = participationIds.get(key)
      if (!participationId) continue
      const active = await tx.execute(sql`
        SELECT id, team_id, role FROM team_memberships
        WHERE organization_id = ${plan.participation.organizationId}
          AND property_id = ${plan.participation.propertyId}
          AND staff_participation_id = ${participationId}
          AND effective_to IS NULL
        LIMIT 1
      `)
      const current = active.rows[0] as
        | { id: string; team_id: string; role: 'member' | 'lead' }
        | undefined
      if (!current) {
        const inserted = await tx.execute(sql`
          INSERT INTO team_memberships
            (organization_id, property_id, team_id, staff_participation_id,
             role, effective_from, created_by)
          VALUES (
            ${plan.participation.organizationId}, ${plan.participation.propertyId},
            ${plan.teamId}, ${participationId}, ${plan.role},
            ${plan.effectiveFrom}, ${options.createdBy}
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `)
        result.membershipsCreated += inserted.rows.length
        if (plan.role === 'lead') result.leadsPromoted += inserted.rows.length
      } else if (
        current.team_id === plan.teamId &&
        current.role === 'member' &&
        plan.role === 'lead'
      ) {
        const promoted = await tx.execute(sql`
          UPDATE team_memberships tm
          SET role = 'lead', created_by = ${options.createdBy}
          WHERE tm.id = ${current.id}
            AND NOT EXISTS (
              SELECT 1 FROM team_memberships lead
              WHERE lead.organization_id = ${plan.participation.organizationId}
                AND lead.team_id = ${plan.teamId}
                AND lead.role = 'lead'
                AND lead.effective_to IS NULL
            )
          RETURNING id
        `)
        result.leadsPromoted += promoted.rows.length
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
