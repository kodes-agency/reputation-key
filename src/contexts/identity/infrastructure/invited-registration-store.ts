import { and, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import {
  account,
  invitation,
  member,
  session,
  user as userTable,
  verification,
} from '#/shared/db/schema/auth'
import { isBetaInteractiveMemberRoleToken } from '#/shared/domain/beta-interactive-role'
import { organizationId as toOrganizationId } from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import {
  classifyInvitedRegistrationRecovery,
  type InvitedRegistrationRecoveryDecision,
} from '../domain/invited-registration-recovery'
import type {
  InvitedRegistrationStore,
  PreparedInvitedRegistration,
  PrepareInvitedRegistration,
  ReconcileInvitedRegistrationResult,
} from '../application/ports/invited-registration-store.port'

const VERIFICATION_IDENTIFIER_PREFIX = 'invited-registration:'
const VERIFICATION_RETENTION_MS = 24 * 60 * 60 * 1_000

const verificationPayloadSchema = z.object({
  version: z.literal(1),
  invitationId: z.string().min(1),
  organizationId: z.string().min(1),
  authIds: z.object({
    userId: z.string().min(1),
    credentialAccountId: z.string().min(1),
    initialSessionId: z.string().min(1),
  }),
})

type InvitedRegistrationVerification = z.infer<typeof verificationPayloadSchema>
type InvitedRegistrationTx = Parameters<Parameters<Database['transaction']>[0]>[0]

function parseVerificationPayload(value: string): InvitedRegistrationVerification {
  try {
    return verificationPayloadSchema.parse(JSON.parse(value))
  } catch {
    throw identityError(
      'registration_failed',
      'Invited registration verification is invalid',
    )
  }
}

function toPrepared(
  row: Readonly<{ id: string; value: string }>,
): PreparedInvitedRegistration {
  const payload = parseVerificationPayload(row.value)
  return {
    verificationId: row.id,
    invitationId: payload.invitationId as PreparedInvitedRegistration['invitationId'],
    organizationId: toOrganizationId(payload.organizationId),
    authIds: payload.authIds,
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

type ReconcileCommand = Readonly<{
  verificationId: string
  now: Date
  nextRecoveryAt: Date
}>

async function lockVerificationAndInvitation(
  tx: InvitedRegistrationTx,
  command: ReconcileCommand,
) {
  // Read the content-free locator before taking locks, then preserve the
  // invitation-before-verification order used by the acceptance transaction.
  const locatorRows = await tx
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.id, command.verificationId))
    .limit(1)
  const locator = locatorRows[0]
  if (!locator) {
    throw identityError('registration_failed', 'Registration verification not found')
  }
  const locatorPayload = parseVerificationPayload(locator.value)
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
    .where(eq(invitation.id, locatorPayload.invitationId))
    .for('update')
  const verificationRows = await tx
    .select({ id: verification.id, value: verification.value })
    .from(verification)
    .where(eq(verification.id, command.verificationId))
    .for('update')
  const currentVerification = verificationRows[0]
  if (!currentVerification) {
    throw identityError('registration_failed', 'Registration verification not found')
  }
  const payload = parseVerificationPayload(currentVerification.value)
  if (payload.invitationId !== locatorPayload.invitationId) {
    throw identityError('registration_failed', 'Registration verification changed')
  }
  return {
    currentVerification,
    payload,
    currentInvitation: invitationRows[0] ?? null,
  }
}

async function lockObservedProviderArtifacts(
  tx: InvitedRegistrationTx,
  payload: InvitedRegistrationVerification,
) {
  const userRows = await tx
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, payload.authIds.userId))
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
        eq(account.userId, payload.authIds.userId),
        eq(account.id, payload.authIds.credentialAccountId),
      ),
    )
    .for('update')
  const sessionRows = await tx
    .select({ id: session.id, userId: session.userId })
    .from(session)
    .where(
      or(
        eq(session.userId, payload.authIds.userId),
        eq(session.id, payload.authIds.initialSessionId),
      ),
    )
    .for('update')
  const memberRows = await tx
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, payload.authIds.userId))
    .for('update')
  return { userRows, accountRows, sessionRows, memberRows }
}

async function applyRecoveryDecision(
  tx: InvitedRegistrationTx,
  input: Readonly<{
    command: ReconcileCommand
    verificationId: string
    payload: InvitedRegistrationVerification
    currentInvitation: Readonly<{ propertyIds: string | null }> | null
    userRows: ReadonlyArray<Readonly<{ id: string; email: string }>>
    decision: InvitedRegistrationRecoveryDecision
  }>,
): Promise<ReconcileInvitedRegistrationResult> {
  const { command, verificationId, payload, currentInvitation, userRows, decision } =
    input

  if (decision.kind === 'awaiting_provider') {
    await tx
      .update(verification)
      .set({ updatedAt: command.nextRecoveryAt })
      .where(eq(verification.id, verificationId))
    return decision
  }

  if (decision.kind === 'ready_to_accept') {
    await tx
      .update(verification)
      .set({ updatedAt: command.nextRecoveryAt })
      .where(eq(verification.id, verificationId))
    return {
      kind: 'ready_to_accept',
      registration: toPrepared({
        id: verificationId,
        value: JSON.stringify(payload),
      }),
      acceptorEmail: userRows[0]!.email,
    }
  }

  if (decision.kind === 'safe_to_compensate') {
    if (userRows[0]) {
      await tx.delete(userTable).where(eq(userTable.id, payload.authIds.userId))
    }
    await tx.delete(verification).where(eq(verification.id, verificationId))
    return { kind: 'compensated' }
  }

  if (decision.kind === 'already_accepted') {
    await tx.delete(verification).where(eq(verification.id, verificationId))
    return {
      kind: 'accepted',
      organizationId: toOrganizationId(payload.organizationId),
      propertyIds: parsePropertyIds(currentInvitation?.propertyIds),
      userId: payload.authIds.userId,
    }
  }

  // Unexpected provider or membership authority remains visible in its source
  // tables. Dropping this short-lived token prevents an unbounded retry loop;
  // a later foreground attempt will fail closed against those authority rows.
  await tx.delete(verification).where(eq(verification.id, verificationId))
  return { kind: 'manual_review' }
}

/** Persist recovery identity in Better Auth before it starts creating records. */
export const createInvitedRegistrationStore = (
  db: Database,
): InvitedRegistrationStore => ({
  prepare: async (command: PrepareInvitedRegistration) =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`invited-registration:${command.invitationId as string}`}, 0))`,
      )
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

      const identifier = VERIFICATION_IDENTIFIER_PREFIX + (command.invitationId as string)
      const existingRows = await tx
        .select({
          id: verification.id,
          value: verification.value,
        })
        .from(verification)
        .where(eq(verification.identifier, identifier))
        .for('update')
      const existing = existingRows[0]
      if (existing) {
        const prepared = toPrepared(existing)
        if (prepared.organizationId !== currentInvitation.organizationId) {
          throw identityError(
            'registration_failed',
            'Registration verification does not match this invitation',
          )
        }
        await tx
          .update(verification)
          .set({ updatedAt: command.nextRecoveryAt })
          .where(eq(verification.id, existing.id))
        return prepared
      }

      const payload: InvitedRegistrationVerification = {
        version: 1,
        invitationId: command.invitationId as string,
        organizationId: currentInvitation.organizationId,
        authIds: command.proposedAuthIds,
      }
      await tx.insert(verification).values({
        id: command.proposedVerificationId,
        identifier,
        value: JSON.stringify(payload),
        expiresAt: new Date(
          currentInvitation.expiresAt.getTime() + VERIFICATION_RETENTION_MS,
        ),
        createdAt: command.now,
        updatedAt: command.nextRecoveryAt,
      })
      return toPrepared({
        id: command.proposedVerificationId,
        value: JSON.stringify(payload),
      })
    }),

  claimDue: async ({ now, claimExpiresAt, limit }) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Invited registration recovery claim limit is invalid')
    }
    if (claimExpiresAt <= now) {
      throw new Error('Invited registration recovery claim must expire in the future')
    }

    const rows = await db.execute(sql`
      WITH candidates AS (
        SELECT ${verification.id}
        FROM ${verification}
        WHERE ${verification.identifier} LIKE ${`${VERIFICATION_IDENTIFIER_PREFIX}%`}
          AND ${verification.updatedAt} <= ${now}
        ORDER BY ${verification.updatedAt}, ${verification.createdAt}, ${verification.id}
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${verification} AS target
      SET "updatedAt" = ${claimExpiresAt}
      FROM candidates
      WHERE target.id = candidates.id
      RETURNING target.id
    `)
    return rows.rows.map((row) => ({ verificationId: String(row.id) }))
  },

  complete: async (verificationId) => {
    await db
      .delete(verification)
      .where(
        and(
          eq(verification.id, verificationId),
          sql`${verification.identifier} LIKE ${`${VERIFICATION_IDENTIFIER_PREFIX}%`}`,
        ),
      )
  },

  reconcile: async (command) =>
    db.transaction(async (tx) => {
      const { currentVerification, payload, currentInvitation } =
        await lockVerificationAndInvitation(tx, command)
      const { userRows, accountRows, sessionRows, memberRows } =
        await lockObservedProviderArtifacts(tx, payload)
      const decision = classifyInvitedRegistrationRecovery({
        expected: {
          invitationId: payload.invitationId,
          organizationId: payload.organizationId,
          userId: payload.authIds.userId,
          credentialAccountId: payload.authIds.credentialAccountId,
          initialSessionId: payload.authIds.initialSessionId,
        },
        now: command.now,
        user: userRows[0] ?? null,
        invitation: currentInvitation,
        accounts: accountRows,
        sessions: sessionRows,
        memberships: memberRows,
      })

      return applyRecoveryDecision(tx, {
        command,
        verificationId: currentVerification.id,
        payload,
        currentInvitation,
        userRows,
        decision,
      })
    }),
})
