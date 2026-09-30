// Atomic identity command store (BQC-3.5).
//
// One PostgreSQL transaction per command commits the better-auth-owned state
// mutation (invitation / member rows — the app-owned write path, the same
// precedent as the pre-existing acceptInvitation transaction and the
// custom-role writes) together with its outbox_events fact.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row — no state/outbox split is ever observable (the
//   pre-BQC-3.5 use cases could lose the fact between the better-auth write
//   and the separate fact record).
// - A committed outbox row is the durable fact and is delivered by the relay.
// - Guarded transitions (already-member/already-invited, last-owner,
//   invitation lifecycle) record no fact.
// - removeMember/changeMemberRole take the org advisory lock inside the
//   transaction and re-check the last-owner invariant under it, preserving
//   the pre-BQC-3.5 withOrgLock serialization semantics.

import { isBetaInteractiveMemberRoleToken } from '#/shared/domain/beta-interactive-role'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { invitation, member, session, user as userTable } from '#/shared/db/schema/auth'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { isOwnerToken } from '#/shared/domain/roles'
import {
  organizationId as toOrganizationId,
  userId as toUserId,
} from '#/shared/domain/ids'
import { decideUserOrganizationMembership } from '#/shared/auth/user-organization-membership'
import { identityError } from '../domain/errors'
import { invitationState } from '../domain/invitation-state'
import {
  INELIGIBLE_ROLE_MESSAGE,
  INVITATION_CONSUMED_MESSAGE,
  INVITATION_EXPIRED_MESSAGE,
  INVITATION_INACTIVE_MESSAGE,
  INVITATION_OTHER_ADDRESS_MESSAGE,
  REGISTRATION_FAILED_MESSAGE,
} from '../domain/invitation-copy'
import { revokeAllPropertyAccessForUser } from './repositories/property-access-grant.repository'
import type {
  AcceptInvitationCommand,
  CancelInvitationCommand,
  ChangeMemberRoleCommand,
  IdentityCommandStore,
  InviteMemberCommand,
  RemoveMemberCommand,
  RenewInvitationCommand,
  ValidateInvitationRegistrationCommand,
} from '../application/ports/identity-command-store.port'

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

async function checkSingleOrganizationMembership(
  tx: Tx,
  input: Readonly<{ userId: string; organizationId: string }>,
): Promise<Readonly<{ hasCurrentMembership: boolean }>> {
  // Serialize membership creation for this user so two invitations cannot
  // simultaneously place one closed-beta account in different Organizations.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user-organization-membership:${input.userId}`}, 0))`,
  )
  const memberships = await tx
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, input.userId))
  const decision = decideUserOrganizationMembership(
    memberships.map((row) => row.organizationId),
    input.organizationId,
  )
  if (decision.kind === 'allow') {
    return { hasCurrentMembership: true }
  }
  if (decision.reason === 'organization_membership_missing') {
    return { hasCurrentMembership: false }
  }
  throw identityError(
    'organization_conflict',
    'This account already belongs to another Organization',
  )
}

/** Count owner-token members of the org. Caller holds the advisory lock. */
async function countOwners(tx: Tx, orgId: string): Promise<number> {
  const rows = await tx
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, orgId))
  return rows.filter((r) => isOwnerToken(r.role)).length
}

/**
 * Lock the member row FOR UPDATE (under the org advisory lock) and re-check
 * the last-owner invariant. Without `newRole` the member is being removed and
 * any owner triggers the check; with `newRole` it fires only on owner
 * demotion. Single source for removeMember/changeMemberRole (BQC-5.9 E7).
 */
async function lockMemberForRoleChange(
  tx: Tx,
  orgId: string,
  memberId: string,
  opts: { newRole?: string } = {},
): Promise<typeof member.$inferSelect> {
  await lockOrg(tx, orgId)
  const rows = await tx
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
    .for('update')
  const target = rows[0]
  if (!target) {
    throw identityError('member_not_found', 'Member not found in this organization')
  }
  if (
    isOwnerToken(target.role) &&
    (opts.newRole === undefined || !isOwnerToken(opts.newRole))
  ) {
    const owners = await countOwners(tx, orgId)
    if (owners <= 1) {
      throw identityError(
        'last_owner',
        'Cannot remove the last owner of the organization',
      )
    }
  }
  return target
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

/** Serialize every invitation write for one address, across Organizations. */
async function lockInvitationEmail(tx: Tx, email: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`beta-invitation-email:${email}`}, 0))`,
  )
}

/**
 * Guard 1 — an existing membership must either be the current org (duplicate)
 * or another org (closed-beta Organization conflict).
 */
async function assertAddressHasNoMembership(
  tx: Tx,
  email: string,
  organizationId: string,
): Promise<void> {
  const memberRows = await tx
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(userTable, eq(member.userId, userTable.id))
    .where(sql`LOWER(${userTable.email}) = ${email}`)
  if (memberRows.some((row) => row.organizationId === organizationId)) {
    throw identityError('already_exists', 'User is already a member of this organization')
  }
  if (memberRows.length > 0) {
    throw identityError(
      'organization_conflict',
      'This account already belongs to another Organization',
    )
  }
}

type OpenInvitationRow = Readonly<{
  id: string
  organizationId: string
  state: 'pending' | 'expired'
  storedStatus: string
}>

/** The address's open (stored pending or expired) invitations, read as their state. */
async function openInvitationsForAddress(
  tx: Tx,
  email: string,
  now: Date,
): Promise<ReadonlyArray<OpenInvitationRow>> {
  const rows = await tx
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(
      and(
        sql`LOWER(${invitation.email}) = ${email}`,
        inArray(invitation.status, ['pending', 'expired']),
      ),
    )
  return rows.flatMap((row) => {
    const state = invitationState(row.status, row.expiresAt, now)
    return state === 'pending' || state === 'expired'
      ? [
          {
            id: row.id,
            organizationId: row.organizationId,
            state,
            storedStatus: row.status,
          },
        ]
      : []
  })
}

/**
 * Guard 2 — only one Organization may hold a live beta manager invitation for
 * an address. A lapsed row of this Organization is renewed with Resend rather
 * than duplicated; another Organization's lapsed row is marked 'expired' (no
 * fact — the precedent is the 'rejected' write in acceptInvitation) so it
 * stops blocking the address.
 */
async function assertNoCompetingInvitation(
  tx: Tx,
  input: Readonly<{ email: string; organizationId: string; now: Date }>,
): Promise<void> {
  const open = await openInvitationsForAddress(tx, input.email, input.now)
  const mine = open.filter((row) => row.organizationId === input.organizationId)
  const theirs = open.filter((row) => row.organizationId !== input.organizationId)
  if (mine.some((row) => row.state === 'pending')) {
    throw identityError('already_exists', 'User is already invited to this organization')
  }
  if (mine.length > 0) {
    throw identityError(
      'already_exists',
      'This email has an expired invitation. Use Resend to renew it.',
    )
  }
  if (theirs.some((row) => row.state === 'pending')) {
    throw identityError(
      'organization_conflict',
      'This email already has a pending invitation from another Organization',
    )
  }
  const lapsedIds = theirs
    .filter((row) => row.storedStatus === 'pending')
    .map((row) => row.id)
  if (lapsedIds.length > 0) {
    await tx
      .update(invitation)
      .set({ status: 'expired' })
      .where(inArray(invitation.id, lapsedIds))
  }
}

/**
 * The renewed row must not compete with a live invitation elsewhere: another
 * Organization may have invited the address while this one lapsed.
 */
async function assertRenewalHasNoCompetitor(
  tx: Tx,
  input: Readonly<{ id: string; email: string; organizationId: string; now: Date }>,
): Promise<void> {
  const open = await openInvitationsForAddress(tx, input.email, input.now)
  const live = open.filter((row) => row.id !== input.id && row.state === 'pending')
  if (live.some((row) => row.organizationId === input.organizationId)) {
    throw identityError('already_exists', 'User is already invited to this organization')
  }
  if (live.length > 0) {
    throw identityError(
      'organization_conflict',
      'This email already has a pending invitation from another Organization',
    )
  }
}

/**
 * Registration paths only: consuming the emailed link proves the inbox. The
 * row must be exactly the acceptor at the invited address; anything else —
 * including Better Auth's synthetic duplicate-sign-up user, which was never
 * written — rolls the acceptance back.
 */
async function markAcceptorEmailVerified(
  tx: Tx,
  input: Readonly<{ userId: string; email: string; now: Date }>,
): Promise<void> {
  const verified = await tx
    .update(userTable)
    .set({ emailVerified: true, updatedAt: input.now })
    .where(
      and(
        eq(userTable.id, input.userId),
        sql`LOWER(${userTable.email}) = ${input.email}`,
      ),
    )
    .returning({ id: userTable.id })
  if (!verified[0]) {
    throw identityError('registration_failed', REGISTRATION_FAILED_MESSAGE)
  }
}

export const createAtomicIdentityCommandStore = (
  db: Database,
  idGen: () => string,
): IdentityCommandStore => {
  return {
    validateInvitationRegistration: async (
      command: ValidateInvitationRegistrationCommand,
    ) => {
      const rows = await db
        .select({
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .where(eq(invitation.id, command.invitationId as string))
        .limit(1)
      const inv = rows[0]
      if (!inv || inv.status !== 'pending' || inv.expiresAt <= command.now) {
        throw identityError('invitation_not_found', 'Invitation is not available')
      }
      if (inv.email.toLowerCase() !== command.email.toLowerCase()) {
        throw identityError('forbidden', 'Invitation is not addressed to this email')
      }
      if (!isBetaInteractiveMemberRoleToken(inv.role ?? 'member')) {
        throw identityError('forbidden', INELIGIBLE_ROLE_MESSAGE)
      }
    },

    inviteMember: async (command: InviteMemberCommand) => {
      return trace('identity.commandStore.inviteMember', async () => {
        if (!isBetaInteractiveMemberRoleToken(command.role)) {
          throw identityError(
            'forbidden',
            'Only beta manager roles can receive an account invitation',
          )
        }
        const email = command.email.toLowerCase()
        await db.transaction(async (tx) => {
          // Serialize all invitations for an address, including the
          // absent-row race across two Organizations.
          await lockInvitationEmail(tx, email)
          await assertAddressHasNoMembership(tx, email, command.organizationId as string)
          await assertNoCompetingInvitation(tx, {
            email,
            organizationId: command.organizationId as string,
            now: command.now,
          })

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
      })
    },

    acceptInvitation: async (command: AcceptInvitationCommand) => {
      return trace('identity.commandStore.acceptInvitation', async () => {
        const acceptorEmail = command.acceptorEmail.toLowerCase()
        const outcome = await db.transaction(async (tx) => {
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
              inviterId: invitation.inviterId,
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
            throw identityError('forbidden', INVITATION_OTHER_ADDRESS_MESSAGE)
          }
          // 3. Lifecycle gate. The copy is fixed: it reaches the invitee.
          const state = invitationState(inv.status, inv.expiresAt, command.now)
          if (state === 'expired') {
            throw identityError('invitation_expired', INVITATION_EXPIRED_MESSAGE)
          }
          if (state !== 'pending') {
            throw identityError('invitation_not_found', INVITATION_INACTIVE_MESSAGE)
          }
          // 4. Re-validate the role at acceptance. Member users and custom
          //    roles are retained as data but cannot become beta logins.
          const role = (inv.role ?? 'member').trim().toLowerCase()
          if (!isBetaInteractiveMemberRoleToken(role)) {
            await tx
              .update(invitation)
              .set({ status: 'rejected' })
              .where(eq(invitation.id, inv.id))
            return {
              kind: 'rejected' as const,
              message: INELIGIBLE_ROLE_MESSAGE,
            }
          }
          // 5. Re-check Better Auth membership while the invitation is locked.
          //    An incompatible membership aborts invitation consumption and
          //    fact recording in the same transaction.
          const membership = await checkSingleOrganizationMembership(tx, {
            userId: command.acceptorUserId as string,
            organizationId: inv.organizationId,
          })
          if (membership.hasCurrentMembership) {
            throw identityError(
              'already_exists',
              'User is already a member of this Organization',
            )
          }
          // 6. Registration paths: the link proved the inbox. Verified in the
          //    same transaction as the membership, or not at all.
          if (command.markEmailVerified === true) {
            await markAcceptorEmailVerified(tx, {
              userId: command.acceptorUserId as string,
              email: acceptorEmail,
              now: command.now,
            })
          }

          // 7. Create the membership + mark accepted.
          await tx.insert(member).values({
            id: idGen(),
            organizationId: inv.organizationId,
            userId: command.acceptorUserId as string,
            role,
            createdAt: command.now,
          })
          await tx
            .update(invitation)
            .set({ status: 'accepted' })
            .where(eq(invitation.id, inv.id))
          // 8. The fact carries invitation-row data read under the lock.
          const accepted = {
            organizationId: toOrganizationId(inv.organizationId),
            propertyIds: parsePropertyIds(inv.propertyIds),
            inviterId: inv.inviterId ? toUserId(inv.inviterId) : null,
          }
          const fact = command.buildEvent(accepted)
          await insertOutboxRow(tx, fact)
          return { kind: 'accepted' as const, result: accepted }
        })
        if (outcome.kind === 'rejected') {
          throw identityError('forbidden', outcome.message)
        }
        return outcome.result
      })
    },

    renewInvitation: async (command: RenewInvitationCommand) => {
      return trace('identity.commandStore.renewInvitation', async () =>
        db.transaction(async (tx) => {
          const scope = and(
            eq(invitation.id, command.invitationId as string),
            eq(invitation.organizationId, command.organizationId as string),
          )
          // The address names the lock, so read it before taking it.
          const located = await tx
            .select({ email: invitation.email })
            .from(invitation)
            .where(scope)
            .limit(1)
          if (!located[0]) {
            throw identityError('invitation_not_found', 'Invitation not found')
          }
          const email = located[0].email.toLowerCase()
          await lockInvitationEmail(tx, email)
          const rows = await tx
            .select({
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
              status: invitation.status,
              propertyIds: invitation.propertyIds,
            })
            .from(invitation)
            .where(scope)
            .for('update')
          const inv = rows[0]
          if (!inv || (inv.status !== 'pending' && inv.status !== 'expired')) {
            throw identityError('invitation_not_found', INVITATION_CONSUMED_MESSAGE)
          }
          const role = (inv.role ?? 'member').trim().toLowerCase()
          if (!isBetaInteractiveMemberRoleToken(role)) {
            throw identityError('forbidden', INELIGIBLE_ROLE_MESSAGE)
          }
          await assertAddressHasNoMembership(tx, email, command.organizationId as string)
          await assertRenewalHasNoCompetitor(tx, {
            id: inv.id,
            email,
            organizationId: command.organizationId as string,
            now: command.now,
          })
          await tx
            .update(invitation)
            .set({ status: 'pending', expiresAt: command.expiresAt })
            .where(eq(invitation.id, inv.id))
          return {
            email: inv.email,
            role,
            propertyIds: parsePropertyIds(inv.propertyIds),
            expiresAt: command.expiresAt,
          }
        }),
      )
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
                // An accepted, rejected or canceled invitation is history;
                // only an open one can be withdrawn.
                inArray(invitation.status, ['pending', 'expired']),
              ),
            )
            .returning({ id: invitation.id })
          if (!updated[0]) {
            throw identityError('invitation_not_found', 'Invitation not found')
          }
          await insertOutboxRow(tx, command.event)
        })
      })
    },

    removeMember: async (command: RemoveMemberCommand) => {
      return trace('identity.commandStore.removeMember', async () => {
        await db.transaction(async (tx) => {
          const target = await lockMemberForRoleChange(
            tx,
            command.organizationId as string,
            command.memberId,
          )
          if (target.userId !== (command.event.userId as string)) {
            throw identityError(
              'organization_conflict',
              'Member removal fact does not match the locked member authority',
            )
          }
          // Membership removal is also login offboarding. Revoke every
          // current Better Auth session in the same transaction as the
          // membership deletion and durable fact, so a stale cookie cannot
          // survive a committed removal.
          await tx.delete(session).where(eq(session.userId, target.userId))
          // LIF-01-T21: Identity owns `property_access_grant`, so revoking it
          // belongs in this transaction rather than in a preceding one. A
          // grant that survived a committed membership deletion would be
          // live access with no membership behind it.
          await revokeAllPropertyAccessForUser(tx, {
            organizationId: command.organizationId as string,
            userId: target.userId,
            reason: 'member_offboarded',
          })
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
      })
    },

    changeMemberRole: async (command: ChangeMemberRoleCommand) => {
      return trace('identity.commandStore.changeMemberRole', async () => {
        if (!isBetaInteractiveMemberRoleToken(command.newRole)) {
          throw identityError(
            'forbidden',
            'Only beta manager roles can be assigned to login accounts',
          )
        }
        await db.transaction(async (tx) => {
          await lockMemberForRoleChange(
            tx,
            command.organizationId as string,
            command.memberId,
            {
              newRole: command.newRole,
            },
          )
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
      })
    },
  }
}
