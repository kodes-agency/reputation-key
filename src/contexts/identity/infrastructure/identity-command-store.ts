// Atomic identity command store (BQC-3.5).
//
// One PostgreSQL transaction per command: better-auth-owned state mutation
// (invitation / member / organization rows — the app-owned write path, the
// same precedent as the pre-existing acceptInvitation transaction and the
// custom-role writes) + outbox_events insert. After commit: in-process
// EventBus emit for expand-phase legacy consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row — no state/outbox split is ever observable (the
//   pre-BQC-3.5 use cases could lose the fact between the better-auth write
//   and the separate fact record).
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).
// - Guarded transitions (already-member/already-invited, last-owner,
//   invitation lifecycle, slug conflict) record NO fact and emit nothing.
// - removeMember/changeMemberRole take the org advisory lock inside the
//   transaction and re-check the last-owner invariant under it, preserving
//   the pre-BQC-3.5 withOrgLock serialization semantics.

import { randomUUID } from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import {
  invitation,
  member,
  organization,
  organizationRole,
  user as userTable,
} from '#/shared/db/schema/auth'
import { organizationRolePolicy } from '#/shared/db/schema/dac.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { isOwnerToken } from '#/shared/domain/roles'
import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import type {
  AcceptInvitationCommand,
  CancelInvitationCommand,
  ChangeMemberRoleCommand,
  IdentityCommandStore,
  InviteMemberCommand,
  RegisterOrganizationCommand,
  RemoveMemberCommand,
} from '../application/ports/identity-command-store.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  // Expand-phase dual path: durable outbox already committed. Bus failure must
  // not roll back or hide the durable fact (relay will deliver when enabled).
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}

/**
 * Invitation insert via raw SQL. The drizzle mirror for the better-auth
 * invitation table carries a speculative `teamId` column (BA teams plugin,
 * not enabled) that the real table does not have; drizzle's insert emits
 * every mirrored column, so going through the table definition breaks
 * against the real schema. Migration/schema files are owned outside this
 * slice, so the insert bypasses the mirror. Reads/updates use only columns
 * that exist and stay on the typed table.
 */
async function insertInvitationRow(
  tx: Tx,
  row: Readonly<{
    id: string
    organizationId: string
    email: string
    role: string
    expiresAt: Date
    propertyIds: string | null
    inviterId: string
    createdAt: Date
  }>,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "propertyIds", "inviterId", "createdAt")
    VALUES (${row.id}, ${row.organizationId}, ${row.email}, ${row.role}, 'pending', ${row.expiresAt}, ${row.propertyIds}, ${row.inviterId}, ${row.createdAt})
  `)
}

/** Same hash as the pre-BQC-3.5 withOrgLock — the advisory-lock key space is unchanged. */
function hashStringToInteger(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

async function lockOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${hashStringToInteger(orgId)})`)
}

/** Count owner-token members of the org. Caller holds the advisory lock. */
async function countOwners(tx: Tx, orgId: string): Promise<number> {
  const rows = await tx
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, orgId))
  return rows.filter((r) => isOwnerToken(r.role)).length
}

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

export function createAtomicIdentityCommandStore(
  db: Database,
  events: EventBus,
): IdentityCommandStore {
  return {
    inviteMember: async (command: InviteMemberCommand) => {
      return trace('identity.commandStore.inviteMember', async () => {
        const email = command.email.toLowerCase()
        await db.transaction(async (tx) => {
          // Guard 1 — the invitee must not already be a member of the org
          // (mirrors better-auth's findMemberByEmail check).
          const memberRows = await tx
            .select({ id: member.id })
            .from(member)
            .innerJoin(userTable, eq(member.userId, userTable.id))
            .where(
              and(
                eq(userTable.email, email),
                eq(member.organizationId, command.organizationId as string),
              ),
            )
            .limit(1)
          if (memberRows.length > 0) {
            throw identityError(
              'already_exists',
              'User is already a member of this organization',
            )
          }
          // Guard 2 — no pending invitation for the same email + org
          // (mirrors better-auth's findPendingInvitation check).
          const pendingRows = await tx
            .select({ id: invitation.id })
            .from(invitation)
            .where(
              and(
                eq(invitation.organizationId, command.organizationId as string),
                eq(invitation.email, email),
                eq(invitation.status, 'pending'),
              ),
            )
            .limit(1)
          if (pendingRows.length > 0) {
            throw identityError(
              'already_exists',
              'User is already invited to this organization',
            )
          }
          await insertInvitationRow(tx, {
            id: command.invitationId as string,
            organizationId: command.organizationId as string,
            email,
            role: command.role,
            expiresAt: command.expiresAt,
            propertyIds:
              command.propertyIds.length > 0 ? JSON.stringify(command.propertyIds) : null,
            inviterId: command.inviterId as string,
            createdAt: command.now,
          })
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },

    acceptInvitation: async (command: AcceptInvitationCommand) => {
      return trace('identity.commandStore.acceptInvitation', async () => {
        const acceptorEmail = command.acceptorEmail.toLowerCase()
        const { result, event } = await db.transaction(async (tx) => {
          // 1. Lock + load the invitation (serializes concurrent accepts).
          //    Explicit column list — the drizzle mirror carries speculative
          //    columns (teamId) that real better-auth tables do not have.
          const rows = await tx
            .select({
              id: invitation.id,
              organizationId: invitation.organizationId,
              email: invitation.email,
              role: invitation.role,
              status: invitation.status,
              expiresAt: invitation.expiresAt,
              propertyIds: invitation.propertyIds,
            })
            .from(invitation)
            .where(eq(invitation.id, command.invitationId as string))
            .for('update')
          const inv = rows[0]
          if (!inv) {
            throw identityError('invitation_not_found', 'Invitation not found')
          }
          // 2. Email-match invariant — only the invitee may accept.
          if (inv.email.toLowerCase() !== acceptorEmail) {
            throw identityError('forbidden', 'Invitation is not addressed to this user')
          }
          // 3. Lifecycle gate.
          if (inv.status !== 'pending') {
            throw identityError(
              'invitation_not_found',
              `Invitation is no longer pending (status: ${inv.status})`,
            )
          }
          if (inv.expiresAt <= command.now) {
            throw identityError('invitation_not_found', 'Invitation has expired')
          }
          // 4. Re-validate the role at acceptance (custom roles must still
          //    exist as organizationRole + policy, else mark rejected).
          const role = (inv.role ?? 'member').trim().toLowerCase()
          if (!['owner', 'admin', 'member'].includes(role)) {
            const [roleDefs, policies] = await Promise.all([
              tx
                .select({ id: organizationRole.id })
                .from(organizationRole)
                .where(
                  and(
                    eq(organizationRole.organizationId, inv.organizationId),
                    eq(organizationRole.role, role),
                  ),
                ),
              tx
                .select({ id: organizationRolePolicy.id })
                .from(organizationRolePolicy)
                .where(
                  and(
                    eq(organizationRolePolicy.organizationId, inv.organizationId),
                    eq(organizationRolePolicy.role, role),
                  ),
                ),
            ])
            if (roleDefs.length === 0 || policies.length === 0) {
              await tx
                .update(invitation)
                .set({ status: 'rejected' })
                .where(eq(invitation.id, inv.id))
              throw identityError('forbidden', 'Invitation role is no longer available')
            }
          }
          // 5. Create the membership + mark accepted.
          await tx.insert(member).values({
            id: randomUUID(),
            organizationId: inv.organizationId,
            userId: command.acceptorUserId as string,
            role,
            createdAt: command.now,
          })
          await tx
            .update(invitation)
            .set({ status: 'accepted' })
            .where(eq(invitation.id, inv.id))
          // 6. The fact carries invitation-row data read under the lock.
          const accepted = {
            organizationId: toOrganizationId(inv.organizationId),
            propertyIds: parsePropertyIds(inv.propertyIds),
          }
          const fact = command.buildEvent(accepted)
          await insertOutboxRow(tx, fact)
          return { result: accepted, event: fact }
        })
        await emitAfterCommit(events, event)
        return result
      })
    },

    cancelInvitation: async (command: CancelInvitationCommand) => {
      return trace('identity.commandStore.cancelInvitation', async () => {
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(invitation)
            .set({ status: 'canceled' })
            .where(
              and(
                eq(invitation.id, command.invitationId as string),
                eq(invitation.organizationId, command.organizationId as string),
              ),
            )
            .returning({ id: invitation.id })
          if (!updated[0]) {
            throw identityError('invitation_not_found', 'Invitation not found')
          }
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },

    removeMember: async (command: RemoveMemberCommand) => {
      return trace('identity.commandStore.removeMember', async () => {
        await db.transaction(async (tx) => {
          await lockOrg(tx, command.organizationId as string)
          const rows = await tx
            .select()
            .from(member)
            .where(
              and(
                eq(member.id, command.memberId),
                eq(member.organizationId, command.organizationId as string),
              ),
            )
            .for('update')
          const target = rows[0]
          if (!target) {
            throw identityError(
              'member_not_found',
              'Member not found in this organization',
            )
          }
          // Last-owner invariant re-enforced under the advisory lock.
          if (isOwnerToken(target.role)) {
            const owners = await countOwners(tx, command.organizationId as string)
            if (owners <= 1) {
              throw identityError(
                'last_owner',
                'Cannot remove the last owner of the organization',
              )
            }
          }
          await tx
            .delete(member)
            .where(
              and(
                eq(member.id, command.memberId),
                eq(member.organizationId, command.organizationId as string),
              ),
            )
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },

    changeMemberRole: async (command: ChangeMemberRoleCommand) => {
      return trace('identity.commandStore.changeMemberRole', async () => {
        await db.transaction(async (tx) => {
          await lockOrg(tx, command.organizationId as string)
          const rows = await tx
            .select()
            .from(member)
            .where(
              and(
                eq(member.id, command.memberId),
                eq(member.organizationId, command.organizationId as string),
              ),
            )
            .for('update')
          const target = rows[0]
          if (!target) {
            throw identityError(
              'member_not_found',
              'Member not found in this organization',
            )
          }
          // Demoting an owner: re-check the last-owner invariant under the lock.
          if (isOwnerToken(target.role) && !isOwnerToken(command.newRole)) {
            const owners = await countOwners(tx, command.organizationId as string)
            if (owners <= 1) {
              throw identityError(
                'last_owner',
                'Cannot remove the last owner of the organization',
              )
            }
          }
          await tx
            .update(member)
            .set({ role: command.newRole })
            .where(
              and(
                eq(member.id, command.memberId),
                eq(member.organizationId, command.organizationId as string),
              ),
            )
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },

    registerOrganization: async (command: RegisterOrganizationCommand) => {
      return trace('identity.commandStore.registerOrganization', async () => {
        await db.transaction(async (tx) => {
          // Slug-uniqueness guard (better-auth's findOrganizationBySlug parity).
          const existing = await tx
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.slug, command.slug))
            .limit(1)
          if (existing.length > 0) {
            throw identityError(
              'already_exists',
              'An organization with this slug already exists',
            )
          }
          await tx.insert(organization).values({
            id: command.organizationId as string,
            name: command.organizationName,
            slug: command.slug,
            createdAt: command.now,
          })
          await tx.insert(member).values({
            id: randomUUID(),
            organizationId: command.organizationId as string,
            userId: command.ownerId as string,
            role: 'owner',
            createdAt: command.now,
          })
          await insertOutboxRow(tx, command.event)
        })
        await emitAfterCommit(events, command.event)
      })
    },
  }
}
