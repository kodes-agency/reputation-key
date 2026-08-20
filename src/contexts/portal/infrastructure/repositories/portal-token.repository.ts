import { and, desc, eq, gte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalTokens } from '#/shared/db/schema/portal.schema'
import type { PortalTokenRepository } from '../../application/ports/portal-token.repository'
import type { PortalToken, TokenStatus } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

const VALID_TOKEN_STATES: ReadonlySet<string> = new Set(['active', 'rotating', 'revoked'])

function tokenFromRow(row: typeof portalTokens.$inferSelect): PortalToken {
  if (!VALID_TOKEN_STATES.has(row.status)) {
    throw portalError('token_unavailable', 'Stored portal token state is invalid')
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    tokenIdentifier: row.tokenIdentifier,
    tokenHash: row.tokenHash,
    tokenKeyVersion: row.tokenKeyVersion,
    version: row.version,
    printBatch: row.printBatch,
    status: row.status as TokenStatus,
    issuedAt: row.issuedAt,
    gracePeriodEnds: row.gracePeriodEnds,
    retiredAt: row.retiredAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokedReason: row.revokedReason,
  }
}

function tokenToRow(token: PortalToken): typeof portalTokens.$inferInsert {
  return {
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

export const createPortalTokenRepository = (db: Database): PortalTokenRepository => ({
  findLatestForPortal: async (organizationId, portalId) =>
    trace('portalToken.findLatestForPortal', async () => {
      const [row] = await db
        .select()
        .from(portalTokens)
        .where(
          and(
            eq(portalTokens.organizationId, unbrand(organizationId)),
            eq(portalTokens.portalId, unbrand(portalId)),
          ),
        )
        .orderBy(desc(portalTokens.version))
        .limit(1)
      return row ? tokenFromRow(row) : null
    }),

  findResolvableByDigest: async (digest, asOf) =>
    trace('portalToken.findResolvableByDigest', async () => {
      const [row] = await db
        .select()
        .from(portalTokens)
        .where(
          and(
            eq(portalTokens.tokenIdentifier, digest.tokenIdentifier),
            eq(portalTokens.tokenHash, digest.tokenHash),
            eq(portalTokens.tokenKeyVersion, digest.tokenKeyVersion),
            or(
              eq(portalTokens.status, 'active'),
              and(
                eq(portalTokens.status, 'rotating'),
                gte(portalTokens.gracePeriodEnds, asOf),
              ),
            ),
          ),
        )
        .limit(1)
      return row ? tokenFromRow(row) : null
    }),

  insert: async (token) =>
    trace('portalToken.insert', async () => {
      await db.insert(portalTokens).values(tokenToRow(token))
    }),

  saveRotation: async ({ oldToken, newToken }) =>
    trace('portalToken.saveRotation', async () => {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(portalTokens)
          .set({
            status: oldToken.status,
            gracePeriodEnds: oldToken.gracePeriodEnds,
            retiredAt: oldToken.retiredAt,
          })
          .where(
            and(
              eq(portalTokens.id, oldToken.id),
              eq(portalTokens.organizationId, oldToken.organizationId),
              eq(portalTokens.portalId, oldToken.portalId),
              eq(portalTokens.status, 'active'),
            ),
          )
          .returning({ id: portalTokens.id })
        if (updated.length !== 1) {
          throw portalError('token_unavailable', 'Portal token changed during rotation')
        }
        await tx.insert(portalTokens).values(tokenToRow(newToken))
      })
    }),

  revokeForPortal: async (input) =>
    trace('portalToken.revokeForPortal', async () => {
      const rows = await db
        .update(portalTokens)
        .set({
          status: 'revoked',
          revokedAt: input.at,
          retiredAt: input.at,
          revokedBy: input.revokedBy,
          revokedReason: input.reason,
          gracePeriodEnds: null,
        })
        .where(
          and(
            eq(portalTokens.organizationId, unbrand(input.organizationId)),
            eq(portalTokens.portalId, unbrand(input.portalId)),
            or(eq(portalTokens.status, 'active'), eq(portalTokens.status, 'rotating')),
          ),
        )
        .returning({ id: portalTokens.id })
      return rows.length
    }),
})
