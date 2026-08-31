import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  staffParticipations,
  teamMemberships,
} from '#/shared/db/schema/people-access.schema'
import { teams } from '#/shared/db/schema/team.schema'
import type {
  TeamMembershipRepository,
  TeamMembershipView,
} from '../../application/ports/team-membership.repository'

const viewSelection = {
  id: teamMemberships.id,
  organizationId: teamMemberships.organizationId,
  propertyId: teamMemberships.propertyId,
  teamId: teamMemberships.teamId,
  staffParticipationId: teamMemberships.staffParticipationId,
  role: teamMemberships.role,
  effectiveFrom: teamMemberships.effectiveFrom,
  effectiveTo: teamMemberships.effectiveTo,
  createdBy: teamMemberships.createdBy,
  endReason: teamMemberships.endReason,
  // Team is an ADR-0052 quarantine-only path. Historical Team rows are
  // login-bound; participant-without-login rows are excluded below.
  userId: sql<string>`${staffParticipations.userId}`,
  displayName: staffParticipations.displayName,
} as const

function asView(
  row: typeof viewSelection extends infer _Selection
    ? {
        id: string
        organizationId: string
        propertyId: string
        teamId: string
        staffParticipationId: string
        role: 'member' | 'lead'
        effectiveFrom: Date
        effectiveTo: Date | null
        createdBy: string
        endReason: string | null
        userId: string
        displayName: string
      }
    : never,
): TeamMembershipView {
  return row
}

export const createTeamMembershipRepository = (
  db: Database,
): TeamMembershipRepository => ({
  listByTeam: async (organizationId, teamId) => {
    const rows = await db
      .select(viewSelection)
      .from(teamMemberships)
      .innerJoin(
        staffParticipations,
        and(
          eq(staffParticipations.organizationId, teamMemberships.organizationId),
          eq(staffParticipations.propertyId, teamMemberships.propertyId),
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        ),
      )
      .where(
        and(
          eq(teamMemberships.organizationId, organizationId),
          eq(teamMemberships.teamId, teamId),
          isNull(teamMemberships.effectiveTo),
        ),
      )
      .orderBy(desc(teamMemberships.role), asc(staffParticipations.displayName))
    return rows.map(asView)
  },

  listActiveByUser: async (organizationId, userId) => {
    const rows = await db
      .select(viewSelection)
      .from(teamMemberships)
      .innerJoin(
        staffParticipations,
        and(
          eq(staffParticipations.organizationId, teamMemberships.organizationId),
          eq(staffParticipations.propertyId, teamMemberships.propertyId),
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        ),
      )
      .where(
        and(
          eq(teamMemberships.organizationId, organizationId),
          eq(staffParticipations.userId, userId),
          eq(staffParticipations.status, 'active'),
          isNull(teamMemberships.effectiveTo),
        ),
      )
      .orderBy(asc(teamMemberships.teamId))
    return rows.map(asView)
  },

  listAvailableForTeam: async (organizationId, teamId) => {
    const [team] = await db
      .select({ propertyId: teams.propertyId })
      .from(teams)
      .where(
        and(
          eq(teams.organizationId, organizationId),
          eq(teams.id, teamId),
          isNull(teams.deletedAt),
        ),
      )
      .limit(1)
    if (!team) return []
    const [participations, activeMemberships] = await Promise.all([
      db
        .select({
          id: staffParticipations.id,
          propertyId: staffParticipations.propertyId,
          userId: sql<string>`${staffParticipations.userId}`,
          displayName: staffParticipations.displayName,
        })
        .from(staffParticipations)
        .where(
          and(
            eq(staffParticipations.organizationId, organizationId),
            eq(staffParticipations.propertyId, team.propertyId),
            eq(staffParticipations.status, 'active'),
            isNotNull(staffParticipations.userId),
          ),
        )
        .orderBy(asc(staffParticipations.displayName)),
      db
        .select({ staffParticipationId: teamMemberships.staffParticipationId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.organizationId, organizationId),
            isNull(teamMemberships.effectiveTo),
          ),
        ),
    ])
    const assigned = new Set(activeMemberships.map((row) => row.staffParticipationId))
    return participations.filter((row) => !assigned.has(row.id))
  },

  findActiveRoleForUser: async (organizationId, teamId, userId) => {
    const [row] = await db
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .innerJoin(
        staffParticipations,
        and(
          eq(staffParticipations.organizationId, teamMemberships.organizationId),
          eq(staffParticipations.propertyId, teamMemberships.propertyId),
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        ),
      )
      .where(
        and(
          eq(teamMemberships.organizationId, organizationId),
          eq(teamMemberships.teamId, teamId),
          eq(staffParticipations.userId, userId),
          eq(staffParticipations.status, 'active'),
          isNull(teamMemberships.effectiveTo),
        ),
      )
      .limit(1)
    return row?.role ?? null
  },

  addMember: async (input) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM teams
        WHERE organization_id = ${input.organizationId}
          AND id = ${input.teamId}
          AND deleted_at IS NULL
        FOR UPDATE
      `)
      const [team] = await tx
        .select({ propertyId: teams.propertyId })
        .from(teams)
        .where(
          and(
            eq(teams.organizationId, input.organizationId),
            eq(teams.id, input.teamId),
            isNull(teams.deletedAt),
          ),
        )
        .limit(1)
      if (!team) return { ok: false as const, code: 'team_not_found' as const }

      await tx.execute(sql`
        SELECT id FROM staff_participations
        WHERE organization_id = ${input.organizationId}
          AND id = ${input.staffParticipationId}
        FOR UPDATE
      `)
      const [participation] = await tx
        .select()
        .from(staffParticipations)
        .where(
          and(
            eq(staffParticipations.organizationId, input.organizationId),
            eq(staffParticipations.id, input.staffParticipationId),
          ),
        )
        .limit(1)
      if (!participation) {
        return { ok: false as const, code: 'participation_not_found' as const }
      }
      if (
        participation.status !== 'active' ||
        participation.propertyId !== team.propertyId ||
        !participation.userId
      ) {
        return { ok: false as const, code: 'participation_not_active' as const }
      }

      const [existing] = await tx
        .select(viewSelection)
        .from(teamMemberships)
        .innerJoin(
          staffParticipations,
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        )
        .where(
          and(
            eq(teamMemberships.organizationId, input.organizationId),
            eq(teamMemberships.staffParticipationId, input.staffParticipationId),
            isNull(teamMemberships.effectiveTo),
          ),
        )
        .limit(1)
      if (existing) {
        if (existing.teamId === input.teamId) {
          return { ok: true as const, membership: asView(existing) }
        }
        return { ok: false as const, code: 'already_on_another_team' as const }
      }

      const [inserted] = await tx
        .insert(teamMemberships)
        .values({
          organizationId: input.organizationId,
          propertyId: team.propertyId,
          teamId: input.teamId,
          staffParticipationId: input.staffParticipationId,
          role: 'member',
          effectiveFrom: input.at,
          createdBy: input.actorId,
        })
        .returning()
      return {
        ok: true as const,
        membership: asView({
          ...inserted,
          userId: participation.userId,
          displayName: participation.displayName,
        }),
      }
    }),

  removeMember: async (input) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM team_memberships
        WHERE organization_id = ${input.organizationId}
          AND team_id = ${input.teamId}
          AND staff_participation_id = ${input.staffParticipationId}
        FOR UPDATE
      `)
      const [active] = await tx
        .select(viewSelection)
        .from(teamMemberships)
        .innerJoin(
          staffParticipations,
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        )
        .where(
          and(
            eq(teamMemberships.organizationId, input.organizationId),
            eq(teamMemberships.teamId, input.teamId),
            eq(teamMemberships.staffParticipationId, input.staffParticipationId),
            isNull(teamMemberships.effectiveTo),
          ),
        )
        .limit(1)
      if (!active) {
        const [ended] = await tx
          .select(viewSelection)
          .from(teamMemberships)
          .innerJoin(
            staffParticipations,
            eq(staffParticipations.id, teamMemberships.staffParticipationId),
          )
          .where(
            and(
              eq(teamMemberships.organizationId, input.organizationId),
              eq(teamMemberships.teamId, input.teamId),
              eq(teamMemberships.staffParticipationId, input.staffParticipationId),
            ),
          )
          .orderBy(desc(teamMemberships.effectiveTo))
          .limit(1)
        return ended
          ? { ok: true as const, membership: asView(ended) }
          : { ok: false as const, code: 'membership_not_found' as const }
      }
      if (active.role === 'lead') {
        return { ok: false as const, code: 'membership_is_lead' as const }
      }
      const [ended] = await tx
        .update(teamMemberships)
        .set({ effectiveTo: input.at, endReason: input.reason })
        .where(eq(teamMemberships.id, active.id))
        .returning()
      return {
        ok: true as const,
        membership: asView({
          ...ended,
          userId: active.userId,
          displayName: active.displayName,
        }),
      }
    }),

  setLead: async (input) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM teams
        WHERE organization_id = ${input.organizationId}
          AND id = ${input.teamId}
          AND deleted_at IS NULL
        FOR UPDATE
      `)
      await tx.execute(sql`
        SELECT id FROM team_memberships
        WHERE organization_id = ${input.organizationId}
          AND team_id = ${input.teamId}
          AND effective_to IS NULL
        ORDER BY id
        FOR UPDATE
      `)
      const rows = await tx
        .select(viewSelection)
        .from(teamMemberships)
        .innerJoin(
          staffParticipations,
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        )
        .where(
          and(
            eq(teamMemberships.organizationId, input.organizationId),
            eq(teamMemberships.teamId, input.teamId),
            isNull(teamMemberships.effectiveTo),
          ),
        )
      const target = rows.find(
        (membership) => membership.staffParticipationId === input.staffParticipationId,
      )
      if (!target) {
        return { ok: false as const, code: 'membership_not_found' as const }
      }
      if (target.role === 'lead') {
        return { ok: true as const, membership: asView(target) }
      }
      const priorLead = rows.find((membership) => membership.role === 'lead')

      // A fixed/injected clock can legitimately yield the same instant for
      // adjacent commands. Collapse a zero-duration state in place rather than
      // manufacturing time or violating the strict interval constraint.
      if (priorLead) {
        if (input.at.getTime() <= priorLead.effectiveFrom.getTime()) {
          await tx
            .update(teamMemberships)
            .set({ role: 'member', createdBy: input.actorId })
            .where(eq(teamMemberships.id, priorLead.id))
        } else {
          await tx
            .update(teamMemberships)
            .set({ effectiveTo: input.at, endReason: 'lead_replaced' })
            .where(eq(teamMemberships.id, priorLead.id))
          await tx.insert(teamMemberships).values({
            organizationId: priorLead.organizationId,
            propertyId: priorLead.propertyId,
            teamId: priorLead.teamId,
            staffParticipationId: priorLead.staffParticipationId,
            role: 'member',
            effectiveFrom: input.at,
            createdBy: input.actorId,
          })
        }
      }

      let newLead: typeof teamMemberships.$inferSelect
      if (input.at.getTime() <= target.effectiveFrom.getTime()) {
        ;[newLead] = await tx
          .update(teamMemberships)
          .set({ role: 'lead', createdBy: input.actorId })
          .where(eq(teamMemberships.id, target.id))
          .returning()
      } else {
        await tx
          .update(teamMemberships)
          .set({ effectiveTo: input.at, endReason: 'appointed_lead' })
          .where(eq(teamMemberships.id, target.id))
        ;[newLead] = await tx
          .insert(teamMemberships)
          .values({
            organizationId: target.organizationId,
            propertyId: target.propertyId,
            teamId: target.teamId,
            staffParticipationId: target.staffParticipationId,
            role: 'lead',
            effectiveFrom: input.at,
            createdBy: input.actorId,
          })
          .returning()
      }
      return {
        ok: true as const,
        membership: asView({
          ...newLead,
          userId: target.userId,
          displayName: target.displayName,
        }),
      }
    }),

  clearLead: async (input) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id FROM team_memberships
        WHERE organization_id = ${input.organizationId}
          AND team_id = ${input.teamId}
          AND effective_to IS NULL
        ORDER BY id
        FOR UPDATE
      `)
      const [lead] = await tx
        .select(viewSelection)
        .from(teamMemberships)
        .innerJoin(
          staffParticipations,
          eq(staffParticipations.id, teamMemberships.staffParticipationId),
        )
        .where(
          and(
            eq(teamMemberships.organizationId, input.organizationId),
            eq(teamMemberships.teamId, input.teamId),
            eq(teamMemberships.role, 'lead'),
            isNull(teamMemberships.effectiveTo),
          ),
        )
        .limit(1)
      if (!lead) return { ok: true as const, membership: null }
      await tx
        .update(teamMemberships)
        .set({ effectiveTo: input.at, endReason: input.reason })
        .where(eq(teamMemberships.id, lead.id))
      const [member] = await tx
        .insert(teamMemberships)
        .values({
          organizationId: lead.organizationId,
          propertyId: lead.propertyId,
          teamId: lead.teamId,
          staffParticipationId: lead.staffParticipationId,
          role: 'member',
          effectiveFrom: input.at,
          createdBy: input.actorId,
        })
        .returning()
      return {
        ok: true as const,
        membership: asView({
          ...member,
          userId: lead.userId,
          displayName: lead.displayName,
        }),
      }
    }),

  closeForTeam: async (organizationId, teamId, at, reason) => {
    const rows = await db
      .update(teamMemberships)
      .set({ effectiveTo: at, endReason: reason })
      .where(
        and(
          eq(teamMemberships.organizationId, organizationId),
          eq(teamMemberships.teamId, teamId),
          isNull(teamMemberships.effectiveTo),
        ),
      )
      .returning({ id: teamMemberships.id })
    return rows.length
  },
})
