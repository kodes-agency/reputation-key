import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  account,
  invitation,
  member,
  session,
  user as userTable,
} from '#/shared/db/schema/auth'
import { userOrganizationBindings } from '#/shared/db/schema/identity-governance.schema'
import { invitedRegistrationAttempts } from '#/shared/db/schema/invited-registration.schema'
import { isBetaInteractiveMemberRoleToken } from '#/shared/domain/beta-interactive-role'
import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import { classifyInvitedRegistrationRecovery } from '../domain/invited-registration-recovery'
import type { InvitedRegistrationRecoveryDecision } from '../domain/invited-registration-recovery'
import type {
  InvitedRegistrationStore,
  PreparedInvitedRegistration,
  PrepareInvitedRegistration,
  ReconcileInvitedRegistrationResult,
} from '../application/ports/invited-registration-store.port'

function toPrepared(
  row: typeof invitedRegistrationAttempts.$inferSelect,
): PreparedInvitedRegistration {
  return {
    id: row.id,
    invitationId: row.invitationId as PreparedInvitedRegistration['invitationId'],
    organizationId: toOrganizationId(row.organizationId),
    authIds: {
      userId: row.expectedUserId,
      credentialAccountId: row.expectedCredentialAccountId,
      initialSessionId: row.expectedInitialSessionId,
    },
  }
}

function parsePropertyIds(raw: string | null | undefined): ReadonlyArray<string> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

type InvitedRegistrationTx = Parameters<Parameters<Database['transaction']>[0]>[0]

type ReconcileCommand = Readonly<{
  attemptId: string
  now: Date
  nextRecoveryAt: Date
  leaseOwner?: string
}>

/**
 * Take the canonical saga locks — invitation first, then recovery attempt — and
 * verify the worker still owns the claim.
 */
async function lockAttemptAndInvitation(
  tx: InvitedRegistrationTx,
  command: ReconcileCommand,
) {
  // Canonical saga lock order is invitation, then recovery attempt.
  // The first read is only a content-free locator; holding the attempt
  // while waiting for the invitation would invert acceptInvitation's
  // lock order and permit a deadlock at the crash boundary.
  const locatorRows = await tx
    .select({ invitationId: invitedRegistrationAttempts.invitationId })
    .from(invitedRegistrationAttempts)
    .where(eq(invitedRegistrationAttempts.id, command.attemptId))
    .limit(1)
  const locator = locatorRows[0]
  if (!locator) {
    throw identityError('registration_failed', 'Registration attempt not found')
  }
  const invitationRows = await tx
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      propertyIds: invitation.propertyIds,
    })
    .from(invitation)
    .where(eq(invitation.id, locator.invitationId))
    .for('update')
  const attemptRows = await tx
    .select()
    .from(invitedRegistrationAttempts)
    .where(eq(invitedRegistrationAttempts.id, command.attemptId))
    .for('update')
  const attempt = attemptRows[0]
  if (!attempt || attempt.invitationId !== locator.invitationId) {
    throw identityError('registration_failed', 'Registration attempt not found')
  }
  if (
    command.leaseOwner &&
    (attempt.leaseOwner !== command.leaseOwner ||
      !attempt.leaseExpiresAt ||
      attempt.leaseExpiresAt <= command.now)
  ) {
    return { kind: 'claim_lost' as const }
  }
  return {
    kind: 'locked' as const,
    attempt,
    currentInvitation: invitationRows[0] ?? null,
  }
}

/** Lock every provider record the attempt fenced so the classification is stable. */
async function lockObservedProviderArtifacts(
  tx: InvitedRegistrationTx,
  attempt: typeof invitedRegistrationAttempts.$inferSelect,
) {
  const userRows = await tx
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, attempt.expectedUserId))
    .for('update')
  const accountRows = await tx
    .select({
      id: account.id,
      userId: account.userId,
      providerId: account.providerId,
      accountId: account.accountId,
    })
    .from(account)
    .where(
      or(
        eq(account.userId, attempt.expectedUserId),
        eq(account.id, attempt.expectedCredentialAccountId),
      ),
    )
    .for('update')
  const sessionRows = await tx
    .select({ id: session.id, userId: session.userId })
    .from(session)
    .where(
      or(
        eq(session.userId, attempt.expectedUserId),
        eq(session.id, attempt.expectedInitialSessionId),
      ),
    )
    .for('update')
  const memberRows = await tx
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, attempt.expectedUserId))
    .for('update')
  const bindingRows = await tx
    .select({
      organizationId: userOrganizationBindings.organizationId,
      state: userOrganizationBindings.state,
    })
    .from(userOrganizationBindings)
    .where(eq(userOrganizationBindings.userId, attempt.expectedUserId))
    .for('update')
  return { userRows, accountRows, sessionRows, memberRows, bindingRows }
}

/** Attempts already in a terminal state answer from the stored row alone. */
function settledReconcileResult(
  attempt: typeof invitedRegistrationAttempts.$inferSelect,
  currentInvitation: Readonly<{ propertyIds: string | null }> | null,
): ReconcileInvitedRegistrationResult | null {
  if (attempt.state === 'compensated') return { kind: 'compensated' as const }
  if (attempt.state === 'manual_review') return { kind: 'manual_review' as const }
  if (attempt.state === 'accepted') {
    return {
      kind: 'accepted' as const,
      organizationId: toOrganizationId(attempt.organizationId),
      propertyIds: parsePropertyIds(currentInvitation?.propertyIds),
      userId: attempt.expectedUserId,
    }
  }
  return null
}

/** Write the durable outcome the recovery classification selected. */
async function applyRecoveryDecision(
  tx: InvitedRegistrationTx,
  input: Readonly<{
    command: ReconcileCommand
    attempt: typeof invitedRegistrationAttempts.$inferSelect
    currentInvitation: Readonly<{ propertyIds: string | null }> | null
    userRows: ReadonlyArray<Readonly<{ id: string; email: string }>>
    decision: InvitedRegistrationRecoveryDecision
  }>,
): Promise<ReconcileInvitedRegistrationResult> {
  const { command, attempt, currentInvitation, userRows, decision } = input

  if (decision.kind === 'awaiting_provider') {
    await tx
      .update(invitedRegistrationAttempts)
      .set({
        nextRecoveryAt: command.nextRecoveryAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastFailureCode: 'provider_not_observed',
        updatedAt: command.now,
      })
      .where(eq(invitedRegistrationAttempts.id, attempt.id))
    return decision
  }

  if (decision.kind === 'ready_to_accept') {
    await tx
      .update(invitedRegistrationAttempts)
      .set({
        providerObservedAt: attempt.providerObservedAt ?? command.now,
        nextRecoveryAt: command.nextRecoveryAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastFailureCode: null,
        updatedAt: command.now,
      })
      .where(eq(invitedRegistrationAttempts.id, attempt.id))
    return {
      kind: 'ready_to_accept' as const,
      registration: toPrepared(attempt),
      acceptorEmail: userRows[0]!.email,
    }
  }

  if (decision.kind === 'safe_to_compensate') {
    if (userRows[0]) {
      await tx.delete(userTable).where(eq(userTable.id, attempt.expectedUserId))
    }
    await tx
      .update(invitedRegistrationAttempts)
      .set({
        state: 'compensated',
        providerObservedAt: userRows[0]
          ? (attempt.providerObservedAt ?? command.now)
          : attempt.providerObservedAt,
        compensatedAt: command.now,
        nextRecoveryAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastFailureCode: decision.reason,
        updatedAt: command.now,
      })
      .where(eq(invitedRegistrationAttempts.id, attempt.id))
    return { kind: 'compensated' as const }
  }

  if (decision.kind === 'already_accepted') {
    await tx
      .update(invitedRegistrationAttempts)
      .set({
        state: 'accepted',
        providerObservedAt: attempt.providerObservedAt ?? command.now,
        acceptedAt: command.now,
        nextRecoveryAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastFailureCode: null,
        updatedAt: command.now,
      })
      .where(eq(invitedRegistrationAttempts.id, attempt.id))
    return {
      kind: 'accepted' as const,
      organizationId: toOrganizationId(attempt.organizationId),
      propertyIds: parsePropertyIds(currentInvitation?.propertyIds),
      userId: attempt.expectedUserId,
    }
  }

  await tx
    .update(invitedRegistrationAttempts)
    .set({
      state: 'manual_review',
      providerObservedAt: userRows[0]
        ? (attempt.providerObservedAt ?? command.now)
        : attempt.providerObservedAt,
      manualReviewAt: command.now,
      nextRecoveryAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastFailureCode: decision.reason,
      updatedAt: command.now,
    })
    .where(eq(invitedRegistrationAttempts.id, attempt.id))
  return { kind: 'manual_review' as const }
}

/** Persist the recovery fence before Better Auth starts creating records. */
export const createInvitedRegistrationStore = (
  db: Database,
): InvitedRegistrationStore => {
  return {
    prepare: async (command: PrepareInvitedRegistration) => {
      const outcome = await db.transaction(async (tx) => {
        const invitationRows = await tx
          .select({
            id: invitation.id,
            organizationId: invitation.organizationId,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
          })
          .from(invitation)
          .where(eq(invitation.id, command.invitationId as string))
          .for('update')
        const currentInvitation = invitationRows[0]
        if (
          !currentInvitation ||
          currentInvitation.status !== 'pending' ||
          currentInvitation.expiresAt <= command.now
        ) {
          throw identityError('invitation_not_found', 'Invitation is not available')
        }
        if (currentInvitation.email.toLowerCase() !== command.email.toLowerCase()) {
          throw identityError('forbidden', 'Invitation is not addressed to this email')
        }
        if (!isBetaInteractiveMemberRoleToken(currentInvitation.role ?? 'member')) {
          throw identityError(
            'forbidden',
            'This invitation is not eligible for beta manager access',
          )
        }

        const unresolvedRows = await tx
          .select()
          .from(invitedRegistrationAttempts)
          .where(
            and(
              eq(
                invitedRegistrationAttempts.invitationId,
                command.invitationId as string,
              ),
              inArray(invitedRegistrationAttempts.state, ['prepared', 'manual_review']),
            ),
          )
          .for('update')
        const unresolved = unresolvedRows[0]
        if (unresolved?.state === 'manual_review') {
          throw identityError(
            'registration_failed',
            'Registration requires support review before it can continue',
          )
        }
        if (unresolved) {
          const providerUser = await tx
            .select({ id: userTable.id })
            .from(userTable)
            .where(eq(userTable.id, unresolved.expectedUserId))
            .limit(1)
          const memberships = await tx
            .select({ organizationId: member.organizationId })
            .from(member)
            .where(eq(member.userId, unresolved.expectedUserId))
          const bindings = await tx
            .select({ state: userOrganizationBindings.state })
            .from(userOrganizationBindings)
            .where(eq(userOrganizationBindings.userId, unresolved.expectedUserId))
            .limit(1)
          if (memberships.length > 0 || bindings.length > 0) {
            await tx
              .update(invitedRegistrationAttempts)
              .set({
                state: 'manual_review',
                manualReviewAt: command.now,
                nextRecoveryAt: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                lastFailureCode: 'unexpected_authority',
                updatedAt: command.now,
              })
              .where(eq(invitedRegistrationAttempts.id, unresolved.id))
            return { kind: 'manual_review' as const }
          }
          if (providerUser.length > 0) {
            throw identityError(
              'registration_failed',
              'Registration recovery is in progress; retry shortly',
            )
          }
          const updatedRows = await tx
            .update(invitedRegistrationAttempts)
            .set({
              requestCount: sql`${invitedRegistrationAttempts.requestCount} + 1`,
              nextRecoveryAt: command.nextRecoveryAt,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: null,
              updatedAt: command.now,
            })
            .where(eq(invitedRegistrationAttempts.id, unresolved.id))
            .returning()
          return {
            kind: 'prepared' as const,
            registration: toPrepared(updatedRows[0]!),
          }
        }

        const ordinalRows = await tx
          .select({
            value: sql<number>`COALESCE(MAX(${invitedRegistrationAttempts.attemptOrdinal}), 0)`,
          })
          .from(invitedRegistrationAttempts)
          .where(
            eq(invitedRegistrationAttempts.invitationId, command.invitationId as string),
          )
        const insertedRows = await tx
          .insert(invitedRegistrationAttempts)
          .values({
            id: command.proposedAttemptId,
            invitationId: command.invitationId as string,
            organizationId: currentInvitation.organizationId,
            expectedUserId: command.proposedAuthIds.userId,
            expectedCredentialAccountId: command.proposedAuthIds.credentialAccountId,
            expectedInitialSessionId: command.proposedAuthIds.initialSessionId,
            attemptOrdinal: Number(ordinalRows[0]?.value ?? 0) + 1,
            state: 'prepared',
            requestCount: 1,
            nextRecoveryAt: command.nextRecoveryAt,
            createdAt: command.now,
            updatedAt: command.now,
          })
          .returning()
        return {
          kind: 'prepared' as const,
          registration: toPrepared(insertedRows[0]!),
        }
      })

      // Throw only after the transaction commits. Throwing in the branch above
      // would roll back the durable manual-review fence we just wrote.
      if (outcome.kind === 'manual_review') {
        throw identityError(
          'registration_failed',
          'Registration requires support review before it can continue',
        )
      }
      return outcome.registration
    },

    claimDue: async ({ now, leaseOwner, leaseExpiresAt, limit }) => {
      if (!leaseOwner.trim() || leaseOwner.length > 128) {
        throw new Error('Invited registration recovery lease owner is invalid')
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('Invited registration recovery claim limit is invalid')
      }
      if (leaseExpiresAt <= now) {
        throw new Error('Invited registration recovery lease must expire in the future')
      }

      const rows = await db.execute(sql`
        WITH candidates AS (
          SELECT id
          FROM ${invitedRegistrationAttempts}
          WHERE ${invitedRegistrationAttempts.state} = 'prepared'
            AND ${invitedRegistrationAttempts.nextRecoveryAt} <= ${now}
            AND (
              ${invitedRegistrationAttempts.leaseExpiresAt} IS NULL
              OR ${invitedRegistrationAttempts.leaseExpiresAt} <= ${now}
            )
          ORDER BY ${invitedRegistrationAttempts.nextRecoveryAt},
                   ${invitedRegistrationAttempts.createdAt},
                   ${invitedRegistrationAttempts.id}
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${invitedRegistrationAttempts} AS target
        SET lease_owner = ${leaseOwner},
            lease_expires_at = ${leaseExpiresAt},
            updated_at = ${now}
        FROM candidates
        WHERE target.id = candidates.id
        RETURNING target.id
      `)
      return rows.rows.map((row) => ({ id: String(row.id) }))
    },

    reconcile: async (command) =>
      db.transaction(async (tx) => {
        const locked = await lockAttemptAndInvitation(tx, command)
        if (locked.kind === 'claim_lost') return locked
        const { attempt, currentInvitation } = locked

        const { userRows, accountRows, sessionRows, memberRows, bindingRows } =
          await lockObservedProviderArtifacts(tx, attempt)

        const settled = settledReconcileResult(attempt, currentInvitation)
        if (settled) return settled

        const decision = classifyInvitedRegistrationRecovery({
          expected: {
            attemptId: attempt.id,
            invitationId: attempt.invitationId,
            organizationId: attempt.organizationId,
            userId: attempt.expectedUserId,
            credentialAccountId: attempt.expectedCredentialAccountId,
            initialSessionId: attempt.expectedInitialSessionId,
          },
          now: command.now,
          user: userRows[0] ?? null,
          invitation: currentInvitation,
          accounts: accountRows,
          sessions: sessionRows,
          memberships: memberRows,
          binding: bindingRows[0] ?? null,
        })

        return applyRecoveryDecision(tx, {
          command,
          attempt,
          currentInvitation,
          userRows,
          decision,
        })
      }),
  }
}
