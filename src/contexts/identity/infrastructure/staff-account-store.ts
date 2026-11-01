import { takeStaffAddressSlot } from './staff-address-slots'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { PoolClient } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { organizationId, userId, invitationId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { identityMemberInvited } from '../domain/events'
import { staffAccountError, type StaffOnboarding } from '../domain/staff-account'
import type { StaffAccountStore } from '../application/ports/staff-account-store.port'
import { linkStaffInvitation } from './staff-invitation-link'
import { createGrantAccessLookup } from './adapters/grant-access-lookup.adapter'

const columns = sql`id, organization_id AS "organizationId", property_id AS "propertyId", email, display_name AS "displayName", source_portal_id AS "sourcePortalId", portal_group_id AS "portalGroupId", requested_by AS "requestedBy", status, step, staff_participant_id AS "staffParticipantId", staff_participation_id AS "staffParticipationId", portal_id AS "portalId", invitation_id AS "invitationId", failure_code AS "failureCode"`
const operation = (rows: unknown[]): StaffOnboarding => {
  if (!rows[0])
    throw staffAccountError(
      'operation_conflict',
      'The staff operation is no longer available',
    )
  return rows[0] as StaffOnboarding
}

/** All checkpoint writes commit independently, including a failed step. */
export function createStaffAccountStore(
  db: Omit<Database, '$client'>,
  clock: () => Date,
  pool: Readonly<{ connect: () => Promise<PoolClient> }>,
): StaffAccountStore {
  const store: StaffAccountStore = {
    withAddressLock: async (organizationId, email, run) => {
      const releaseAddressSlot = await takeStaffAddressSlot(organizationId)
      const client = await pool.connect().catch((error: unknown) => {
        releaseAddressSlot()
        throw error
      })
      const key = `beta-invitation-email:${email}`
      try {
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key])
        return await run(createStaffAccountStore(drizzle(client), clock, pool))
      } finally {
        try {
          await client
            .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key])
            .then(
              () => client.release(),
              (error: unknown) => {
                client.release(true)
                throw error
              },
            )
        } finally {
          releaseAddressSlot()
        }
      }
    },
    currentActor: async (ctx) => {
      const roles = await db.execute(
        sql`SELECT role FROM member WHERE "organizationId" = ${ctx.organizationId} AND "userId" = ${ctx.userId} AND (SELECT count(*) FROM member WHERE "userId" = ${ctx.userId}) = 1`,
      )
      const role = roles.rows[0]?.role
      if (typeof role !== 'string' || !['owner', 'admin'].includes(role)) return null
      return (
        await resolveMemberAuthContextWithDatabase(db, {
          memberRole: role,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        })
      ).context
    },
    propertyIds: async (ctx) =>
      ctx.role === 'AccountAdmin'
        ? null
        : createGrantAccessLookup(db, clock)(ctx.organizationId, ctx.userId),
    addressFacts: async (org, property, email) => {
      const users = await db.execute(
        sql`SELECT id FROM "user" WHERE lower(email) = ${email}`,
      )
      const accountId = users.rows[0]?.id as string | undefined
      const memberships = accountId
        ? await db.execute(
            sql`SELECT "organizationId" AS id FROM member WHERE "userId" = ${accountId}`,
          )
        : { rows: [] }
      const links = accountId
        ? await db.execute(
            sql`SELECT l.staff_participant_id AS id, person.display_name AS "staffDisplayName" FROM staff_user_links l JOIN staff_participants person ON person.organization_id = l.organization_id AND person.id = l.staff_participant_id WHERE l.organization_id = ${org} AND l.user_id = ${accountId} AND l.effective_from <= ${clock()} AND l.effective_to IS NULL`,
          )
        : { rows: [] }
      const participantId = links.rows[0]?.id as string | undefined
      const active = await db.execute(sql`
        SELECT id FROM staff_participations WHERE organization_id = ${org} AND property_id = ${property}::uuid AND status = 'active'
        AND (staff_participant_id = ${participantId ?? null}::uuid OR id::text IN (SELECT "staffParticipationId" FROM invitation WHERE "organizationId" = ${org} AND lower(email) = ${email} AND status IN ('pending', 'expired', 'accepted')))
      `)
      const unfinished = await db.execute(
        sql`SELECT id FROM staff_onboardings WHERE organization_id = ${org} AND property_id = ${property}::uuid AND email = ${email} AND status IN ('running', 'failed') LIMIT 1`,
      )
      const invited = await db.execute(
        sql`SELECT id FROM invitation WHERE "organizationId" = ${org} AND lower(email) = ${email} AND status = 'pending' AND "expiresAt" > ${clock()} LIMIT 1`,
      )
      const competing = await db.execute(
        sql`SELECT "organizationId" AS id FROM invitation WHERE lower(email) = ${email} AND "organizationId" <> ${org} AND status = 'pending' AND "expiresAt" > ${clock()}`,
      )
      return {
        userId: accountId ?? null,
        organizationIds: [...memberships.rows, ...competing.rows].map((row) =>
          String(row.id),
        ),
        staffParticipantId: participantId ?? null,
        ...(typeof links.rows[0]?.staffDisplayName === 'string'
          ? { staffDisplayName: links.rows[0].staffDisplayName }
          : {}),
        alreadyInvited: invited.rows.length > 0,
        alreadyStaffHere: active.rows.length > 0 || unfinished.rows.length > 0,
      }
    },
    findOperation: async (org, id) => {
      const result = await db.execute(
        sql`SELECT ${columns} FROM staff_onboardings WHERE organization_id = ${org} AND id = ${id}::uuid`,
      )
      if (!result.rows.length) return null
      const row = operation(result.rows)
      if (row.status === 'running' || row.status === 'failed') {
        const ended = await db.execute(
          sql`SELECT id FROM staff_participations WHERE organization_id = ${org} AND id = ${row.staffParticipationId}::uuid AND status = 'archived'`,
        )
        if (ended.rows.length)
          throw staffAccountError(
            'operation_conflict',
            'This staff setup is being removed. Retry Remove before adding the person again',
          )
      }
      return row
    },
    reserve: async (row) =>
      operation(
        (
          await db.execute(sql`
      INSERT INTO staff_onboardings (id, organization_id, property_id, email, display_name, source_portal_id, portal_group_id, requested_by, status, step, staff_participant_id, staff_participation_id, portal_id, invitation_id)
      VALUES (${row.id}::uuid, ${row.organizationId}, ${row.propertyId}::uuid, ${row.email}, ${row.displayName}, ${row.sourcePortalId}::uuid, ${row.portalGroupId}::uuid, ${row.requestedBy}, 'running', 'person', ${row.staffParticipantId}::uuid, ${row.staffParticipationId}::uuid, ${row.portalId}::uuid, ${row.invitationId}) RETURNING ${columns}
    `)
        ).rows,
      ),
    checkpoint: async (id, step, status, code) =>
      operation(
        (
          await db.execute(sql`
      UPDATE staff_onboardings SET step = ${step}, status = ${status}, failure_code = ${code}, updated_at = ${clock()},
        email = CASE WHEN ${status} IN ('done', 'cancelled') THEN NULL ELSE email END,
        display_name = CASE WHEN ${status} IN ('done', 'cancelled') THEN NULL ELSE display_name END
      WHERE id = ${id}::uuid AND status NOT IN ('done', 'cancelled') RETURNING ${columns}
    `)
        ).rows,
      ),
    createPerson: async (row) => {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`INSERT INTO staff_participants (id, organization_id, display_name, created_by) VALUES (${row.staffParticipantId}::uuid, ${row.organizationId}, ${row.displayName}, ${row.requestedBy}) ON CONFLICT (id) DO NOTHING`,
        )
        const name = await currentPersonName(tx, row)
        await tx.execute(
          sql`UPDATE staff_onboardings SET display_name = ${name} WHERE id = ${row.id}::uuid`,
        )
        await tx.execute(
          sql`INSERT INTO staff_participations (id, organization_id, property_id, staff_participant_id, display_name, created_by) VALUES (${row.staffParticipationId}::uuid, ${row.organizationId}, ${row.propertyId}::uuid, ${row.staffParticipantId}::uuid, ${name}, ${row.requestedBy}) ON CONFLICT (id) DO NOTHING`,
        )
      })
    },
    assignPortal: async (row, writePortalName) => {
      await db.transaction(async (tx) => {
        const name = await currentPersonName(tx, row)
        await tx.execute(
          sql`SELECT id FROM staff_participations WHERE id = ${row.staffParticipationId}::uuid AND organization_id = ${row.organizationId} FOR UPDATE`,
        )
        await tx.execute(
          sql`UPDATE staff_onboardings SET display_name = ${name} WHERE id = ${row.id}::uuid`,
        )
        await writePortalName(tx, name)
        await tx.execute(sql`INSERT INTO portal_responsibilities (organization_id, property_id, portal_id, staff_participation_id, kind, effective_from, created_by)
          SELECT ${row.organizationId}, ${row.propertyId}::uuid, ${row.portalId}::uuid, ${row.staffParticipationId}::uuid, 'primary', ${clock()}, ${row.requestedBy}
          WHERE NOT EXISTS (SELECT 1 FROM portal_responsibilities WHERE organization_id = ${row.organizationId} AND portal_id = ${row.portalId}::uuid AND staff_participation_id = ${row.staffParticipationId}::uuid AND effective_to IS NULL)`)
        await tx.execute(
          sql`UPDATE staff_participations SET personal_portal_id = ${row.portalId}::uuid, display_name = ${name} WHERE id = ${row.staffParticipationId}::uuid AND organization_id = ${row.organizationId}`,
        )
      })
    },
    grantAccess: async (row, spendInvitationBudget) =>
      db.transaction(async (tx) => {
        const facts = await store.addressFacts(
          row.organizationId,
          row.propertyId,
          row.email!,
        )
        if (facts.organizationIds.some((id) => id !== row.organizationId))
          throw staffAccountError(
            'other_organization',
            'This address belongs to another Organization',
          )
        if (facts.userId && facts.organizationIds.includes(row.organizationId)) {
          await linkStaffInvitation(tx, {
            organizationId: row.organizationId,
            participationId: row.staffParticipationId,
            userId: facts.userId,
            actorId: row.requestedBy,
            at: clock(),
          })
          return { invited: false, userId: facts.userId }
        }
        const existing = await tx.execute(
          sql`SELECT id FROM invitation WHERE id = ${row.invitationId} AND "organizationId" = ${row.organizationId}`,
        )
        if (facts.alreadyInvited && !existing.rows.length)
          throw staffAccountError(
            'already_invited',
            "This address already has an open invitation. Add them here once they've accepted.",
          )
        if (!existing.rows.length) await spendInvitationBudget()
        const inserted =
          await tx.execute(sql`INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "staffParticipationId", "propertyIds", "inviterId", "createdAt")
        VALUES (${row.invitationId}, ${row.organizationId}, ${row.email}, 'member', 'pending', ${new Date(clock().getTime() + 7 * 86400000)}, ${row.staffParticipationId}, NULL, ${row.requestedBy}, ${clock()}) ON CONFLICT (id) DO NOTHING RETURNING id`)
        if (inserted.rows.length)
          await insertOutboxRow(
            tx,
            identityMemberInvited({
              organizationId: organizationId(row.organizationId),
              userId: userId(row.requestedBy),
              role: 'Member',
              invitationId: invitationId(row.invitationId),
              occurredAt: clock(),
            }),
          )
        return { invited: true, userId: null }
      }),
  }
  return store
}

async function currentPersonName(
  db: Pick<Database, 'execute'>,
  row: StaffOnboarding,
): Promise<string> {
  const result = await db.execute(
    sql`SELECT display_name FROM staff_participants WHERE organization_id = ${row.organizationId} AND id = ${row.staffParticipantId}::uuid AND status = 'active' FOR UPDATE`,
  )
  const name = result.rows[0]?.display_name
  if (typeof name !== 'string')
    throw staffAccountError(
      'operation_conflict',
      'This staff person is no longer active. Remove this setup before adding them again',
    )
  if (!name || name.length > 100)
    throw staffAccountError(
      'name_required',
      'Shorten the staff name to 100 characters before adding another Property',
    )
  return name
}
