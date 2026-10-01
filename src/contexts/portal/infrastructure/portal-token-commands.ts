// Portal command store — portal token commands.
// Split out of portal-command-store.ts (round 4 F3); composed back behind the
// same PortalCommandStore port by createAtomicPortalCommandStore.

import { and, desc, eq, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalAccessArtifacts, portalTokens } from '#/shared/db/schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  IssuePortalTokenCommand,
  PortalCommandStore,
  RevokePortalTokensCommand,
  RotatePortalTokenCommand,
} from '../application/ports/portal-command-store.port'
import { portalError } from '../domain/errors'
import { fencePortalContent } from './portal-aggregate-fence'
import { sameInstant } from './portal-command-guards'
import { NO_SEALED_ADDRESS } from './portal-sealed-address-columns'

export type PortalTokenCommandStore = Pick<
  PortalCommandStore,
  'issuePortalToken' | 'rotatePortalToken' | 'revokePortalTokens'
>

function sealedAddressColumns(
  sealed: IssuePortalTokenCommand['sealedAddress'],
): Pick<
  typeof portalTokens.$inferInsert,
  'encryptedRawToken' | 'addressEncryptionKeyVersion'
> {
  return sealed === null
    ? NO_SEALED_ADDRESS
    : {
        encryptedRawToken: sealed.ciphertext,
        addressEncryptionKeyVersion: sealed.keyVersion,
      }
}

function isWellFormedSealedAddress(
  sealed: IssuePortalTokenCommand['sealedAddress'],
): boolean {
  return (
    sealed === null ||
    (Number.isInteger(sealed.keyVersion) &&
      sealed.keyVersion >= 1 &&
      sealed.ciphertext.length > 0)
  )
}

function portalTokenToRow(
  token: import('../domain/portal-token').PortalToken,
  provenance: Pick<IssuePortalTokenCommand, 'issuedBy' | 'sealedAddress'>,
): typeof portalTokens.$inferInsert {
  return {
    ...sealedAddressColumns(provenance.sealedAddress),
    issuedBy: unbrand(provenance.issuedBy),
    id: token.id,
    organizationId: token.organizationId,
    propertyId: token.propertyId,
    portalId: token.portalId,
    tokenIdentifier: token.tokenIdentifier,
    tokenHash: token.tokenHash,
    tokenKeyVersion: token.tokenKeyVersion,
    version: token.version,
    printBatch: token.printBatch,
    status: token.status,
    issuedAt: token.issuedAt,
    gracePeriodEnds: token.gracePeriodEnds,
    retiredAt: token.retiredAt,
    revokedAt: token.revokedAt,
    revokedBy: token.revokedBy,
    revokedReason: token.revokedReason,
  }
}

function accessArtifactToRow(
  artifact: import('../domain/portal-access-artifact').PortalAccessArtifact,
): typeof portalAccessArtifacts.$inferInsert {
  return {
    id: artifact.id,
    organizationId: artifact.organizationId,
    propertyId: artifact.propertyId,
    portalId: artifact.portalId,
    portalTokenId: artifact.portalTokenId,
    channel: artifact.channel,
    status: artifact.status,
    publishedAt: artifact.publishedAt,
    retiredAt: artifact.retiredAt,
  }
}

function accessArtifactSetMatches(
  command: Readonly<{
    organizationId: IssuePortalTokenCommand['organizationId']
    propertyId: IssuePortalTokenCommand['propertyId']
    portalId: IssuePortalTokenCommand['portalId']
    revision: Date
    occurredAt: Date
    accessArtifacts: IssuePortalTokenCommand['accessArtifacts']
    accessArtifactEvents: IssuePortalTokenCommand['accessArtifactEvents']
  }>,
  portalTokenId: string,
): boolean {
  if (
    command.accessArtifacts[0].channel !== 'qr' ||
    command.accessArtifacts[1].channel !== 'nfc'
  ) {
    return false
  }
  return command.accessArtifacts.every((artifact, index) => {
    const event = command.accessArtifactEvents[index]
    return (
      event !== undefined &&
      artifact.organizationId === command.organizationId &&
      artifact.propertyId === command.propertyId &&
      artifact.portalId === command.portalId &&
      artifact.portalTokenId === portalTokenId &&
      artifact.status === 'published' &&
      artifact.retiredAt === null &&
      sameInstant(artifact.publishedAt, command.occurredAt) &&
      event.accessArtifactId === artifact.id &&
      event.organizationId === command.organizationId &&
      event.propertyId === command.propertyId &&
      event.portalId === command.portalId &&
      event.channel === artifact.channel &&
      event.sourceAggregateVersion === command.revision.toISOString() &&
      sameInstant(event.occurredAt, command.occurredAt)
    )
  })
}

function assertIssueTokenCommand(command: IssuePortalTokenCommand): void {
  if (
    command.token.organizationId !== unbrand(command.organizationId) ||
    command.token.propertyId !== unbrand(command.propertyId) ||
    command.token.portalId !== unbrand(command.portalId) ||
    command.token.status !== 'active' ||
    !accessArtifactSetMatches(command, command.token.id) ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.tokenIdentifier !== command.token.tokenIdentifier ||
    command.event.version !== command.token.version ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt) ||
    !sameInstant(command.token.issuedAt, command.occurredAt) ||
    !isWellFormedSealedAddress(command.sealedAddress)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal token issue')
  }
}

function assertRotateTokenCommand(command: RotatePortalTokenCommand): void {
  const oldToken = command.oldToken
  const newToken = command.newToken
  if (
    oldToken.organizationId !== unbrand(command.organizationId) ||
    oldToken.propertyId !== unbrand(command.propertyId) ||
    oldToken.portalId !== unbrand(command.portalId) ||
    oldToken.status !== 'rotating' ||
    !oldToken.gracePeriodEnds ||
    newToken.organizationId !== oldToken.organizationId ||
    newToken.propertyId !== oldToken.propertyId ||
    newToken.portalId !== oldToken.portalId ||
    newToken.status !== 'active' ||
    newToken.version !== oldToken.version + 1 ||
    !accessArtifactSetMatches(command, newToken.id) ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.previousVersion !== oldToken.version ||
    command.event.version !== newToken.version ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.gracePeriodEnds, oldToken.gracePeriodEnds) ||
    !sameInstant(command.event.occurredAt, command.occurredAt) ||
    !sameInstant(newToken.issuedAt, command.occurredAt) ||
    !isWellFormedSealedAddress(command.sealedAddress)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal token rotate')
  }
}

function assertRevokeTokenCommand(command: RevokePortalTokensCommand): void {
  if (
    command.reason.trim().length === 0 ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal token revoke')
  }
}

export const createPortalTokenCommands = (db: Database): PortalTokenCommandStore => {
  return {
    issuePortalToken: async (command) =>
      trace('portal.commandStore.issuePortalToken', async () => {
        assertIssueTokenCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          await tx.execute(sql`
            SELECT id FROM portal_tokens
            WHERE organization_id = ${unbrand(command.organizationId)}
              AND portal_id = ${unbrand(command.portalId)}
            FOR UPDATE
          `)
          const [latest] = await tx
            .select({ version: portalTokens.version, status: portalTokens.status })
            .from(portalTokens)
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
              ),
            )
            .orderBy(desc(portalTokens.version))
            .limit(1)
          if (latest && latest.status !== 'revoked') {
            throw portalError(
              'token_unavailable',
              'Rotate the active portal token instead',
            )
          }
          if (command.token.version !== (latest?.version ?? 0) + 1) {
            throw portalError(
              'revision_conflict',
              'Portal token version changed during issue',
            )
          }
          await tx.insert(portalTokens).values(portalTokenToRow(command.token, command))
          await tx
            .insert(portalAccessArtifacts)
            .values(command.accessArtifacts.map(accessArtifactToRow))
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          for (const event of command.accessArtifactEvents) {
            await insertOutboxRow(tx, event, { recordedAt: command.occurredAt })
          }
        })
      }),

    rotatePortalToken: async (command) =>
      trace('portal.commandStore.rotatePortalToken', async () => {
        assertRotateTokenCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [rotated] = await tx
            .update(portalTokens)
            .set({
              status: command.oldToken.status,
              gracePeriodEnds: command.oldToken.gracePeriodEnds,
              retiredAt: command.oldToken.retiredAt,
              // The outgoing code keeps working for its window, but nobody can
              // download it again (ADR 0064).
              ...NO_SEALED_ADDRESS,
            })
            .where(
              and(
                eq(portalTokens.id, command.oldToken.id),
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                eq(portalTokens.version, command.oldToken.version),
                eq(portalTokens.status, 'active'),
              ),
            )
            .returning({ id: portalTokens.id })
          if (!rotated) {
            throw portalError('revision_conflict', 'Portal token changed during rotation')
          }
          await tx
            .insert(portalTokens)
            .values(portalTokenToRow(command.newToken, command))
          await tx
            .insert(portalAccessArtifacts)
            .values(command.accessArtifacts.map(accessArtifactToRow))
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          for (const event of command.accessArtifactEvents) {
            await insertOutboxRow(tx, event, { recordedAt: command.occurredAt })
          }
        })
      }),

    revokePortalTokens: async (command) =>
      trace('portal.commandStore.revokePortalTokens', async () => {
        assertRevokeTokenCommand(command)
        const revoked = await db.transaction(async (tx) => {
          const [live] = await tx
            .select({ id: portalTokens.id })
            .from(portalTokens)
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                or(
                  eq(portalTokens.status, 'active'),
                  eq(portalTokens.status, 'rotating'),
                ),
              ),
            )
            .limit(1)
          if (!live) return 0
          // All Portal/token commands acquire the aggregate fence before token
          // row locks. Keeping one lock order avoids rotate-vs-revoke deadlocks.
          await fencePortalContent(tx, command)
          const rows = await tx
            .update(portalTokens)
            .set({
              status: 'revoked',
              revokedAt: command.occurredAt,
              retiredAt: command.occurredAt,
              revokedBy: unbrand(command.revokedBy),
              revokedReason: command.reason.trim(),
              gracePeriodEnds: null,
              ...NO_SEALED_ADDRESS,
            })
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                or(
                  eq(portalTokens.status, 'active'),
                  eq(portalTokens.status, 'rotating'),
                ),
              ),
            )
            .returning({ id: portalTokens.id })
          if (rows.length === 0) {
            throw portalError('revision_conflict', 'Portal token changed during revoke')
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          return rows.length
        })

        return { revoked }
      }),
  }
}
