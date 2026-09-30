// Invitation read model (Drizzle over the better-auth tables Identity owns).
//
// Explicit column lists only: the better-auth mirror is not the source of the
// real table shape. The inviter is a LEFT join because the name is display
// data — an invitation whose inviter is gone still reads.

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { invitation, organization, user as userTable } from '#/shared/db/schema/auth'
import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { InvitationReadModel } from '../application/ports/invitation-read-model.port'

/** Parse the JSON-encoded propertyIds string from an invitation row. */
function parsePropertyIds(raw: string | null): ReadonlyArray<string> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === 'string')
      : []
  } catch {
    return []
  }
}

const inviter = alias(userTable, 'inviter')

export const createInvitationReadModel = (db: Database): InvitationReadModel => ({
  findForPreview: async (id) =>
    trace('identity.invitations.findForPreview', async () => {
      const rows = await db
        .select({
          id: invitation.id,
          organizationId: invitation.organizationId,
          organizationName: organization.name,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          inviterName: inviter.name,
          propertyIds: invitation.propertyIds,
          accountExists: sql<boolean>`EXISTS (
            SELECT 1 FROM ${userTable}
            WHERE LOWER(${userTable.email}) = LOWER(${invitation.email})
          )`,
        })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .leftJoin(inviter, eq(inviter.id, invitation.inviterId))
        .where(eq(invitation.id, id as string))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      return {
        ...row,
        organizationId: toOrganizationId(row.organizationId),
        inviterName: row.inviterName ?? null,
        propertyIds: parsePropertyIds(row.propertyIds),
        accountExists: row.accountExists === true,
      }
    }),

  listOpenForOrganization: async (orgId) =>
    trace('identity.invitations.listOpenForOrganization', async () => {
      const rows = await db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          inviterName: inviter.name,
          propertyIds: invitation.propertyIds,
        })
        .from(invitation)
        .leftJoin(inviter, eq(inviter.id, invitation.inviterId))
        .where(
          and(
            eq(invitation.organizationId, orgId as string),
            inArray(invitation.status, ['pending', 'expired']),
          ),
        )
        .orderBy(desc(invitation.createdAt), desc(invitation.id))
      return rows.map((row) => ({
        ...row,
        inviterName: row.inviterName ?? null,
        propertyIds: parsePropertyIds(row.propertyIds),
      }))
    }),
})
