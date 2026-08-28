import { and, asc, desc, eq, gte, inArray, isNull, notExists, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalAccessArtifacts, portalTokens } from '#/shared/db/schema/portal.schema'
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

// PB2.1 / ADR 0044: a token reaches its portal while it is active, or while a
// rotated token is still inside the grace window that keeps already-printed QR
// codes working. Both the public token resolution path and the management
// token-status projection use this one predicate so they cannot drift.
const resolvableAsOf = (asOf: Date) =>
  or(
    eq(portalTokens.status, 'active'),
    and(eq(portalTokens.status, 'rotating'), gte(portalTokens.gracePeriodEnds, asOf)),
  )

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

  findResolvableSummaryForPortal: async (organizationId, portalId, asOf) =>
    trace('portalToken.findResolvableSummaryForPortal', async () => {
      // Highest version wins: during a rotation grace window the outgoing token
      // is also resolvable, but the portal's current token is the newer one.
      const [row] = await db
        .select({
          version: portalTokens.version,
          issuedAt: portalTokens.issuedAt,
          gracePeriodEnds: portalTokens.gracePeriodEnds,
          accessArtifactId: portalAccessArtifacts.id,
        })
        .from(portalTokens)
        .leftJoin(
          portalAccessArtifacts,
          and(
            eq(portalAccessArtifacts.portalTokenId, portalTokens.id),
            eq(portalAccessArtifacts.organizationId, portalTokens.organizationId),
            eq(portalAccessArtifacts.propertyId, portalTokens.propertyId),
            eq(portalAccessArtifacts.portalId, portalTokens.portalId),
            eq(portalAccessArtifacts.status, 'published'),
            isNull(portalAccessArtifacts.retiredAt),
          ),
        )
        .where(
          and(
            eq(portalTokens.organizationId, unbrand(organizationId)),
            eq(portalTokens.portalId, unbrand(portalId)),
            resolvableAsOf(asOf),
          ),
        )
        .orderBy(desc(portalTokens.version))
        .limit(1)
      return row
        ? {
            version: row.version,
            issuedAt: row.issuedAt,
            gracePeriodEnds: row.gracePeriodEnds,
            hasPublishedAccessArtifact: row.accessArtifactId !== null,
          }
        : null
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
            resolvableAsOf(asOf),
          ),
        )
        .limit(1)
      return row ? tokenFromRow(row) : null
    }),

  listAccessArtifactReadinessGaps: async (asOf, organizationIds) =>
    trace('portalToken.listAccessArtifactReadinessGaps', async () => {
      const rows = await db
        .select({
          organizationId: portalTokens.organizationId,
          propertyId: portalTokens.propertyId,
          portalId: portalTokens.portalId,
          tokenVersion: portalTokens.version,
          tokenStatus: portalTokens.status,
          issuedAt: portalTokens.issuedAt,
          gracePeriodEnds: portalTokens.gracePeriodEnds,
        })
        .from(portalTokens)
        .where(
          and(
            resolvableAsOf(asOf),
            organizationIds && organizationIds.length > 0
              ? inArray(portalTokens.organizationId, [...organizationIds])
              : undefined,
            notExists(
              db
                .select({ id: portalAccessArtifacts.id })
                .from(portalAccessArtifacts)
                .where(
                  and(
                    eq(portalAccessArtifacts.portalTokenId, portalTokens.id),
                    eq(portalAccessArtifacts.status, 'published'),
                    isNull(portalAccessArtifacts.retiredAt),
                  ),
                ),
            ),
          ),
        )
        .orderBy(
          asc(portalTokens.organizationId),
          asc(portalTokens.propertyId),
          asc(portalTokens.portalId),
          asc(portalTokens.version),
        )
      return rows.flatMap((row) =>
        row.tokenStatus === 'active' || row.tokenStatus === 'rotating'
          ? [
              {
                ...row,
                tokenStatus: row.tokenStatus,
              },
            ]
          : [],
      )
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
