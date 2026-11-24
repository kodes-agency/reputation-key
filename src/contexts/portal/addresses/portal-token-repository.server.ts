import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalAccessArtifacts, portalTokens } from '#/shared/db/schema/portal.schema'
import type { PortalTokenRepository } from './portal-token-repository.port.server'
import type { PortalToken, TokenStatus } from '../domain/portal-token'
import { portalId as toPortalId, unbrand } from '#/shared/domain/ids'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

// The columns a PortalToken is made of. The two whole-row reads name them instead
// of selecting everything, so the sealed address and the print code hashes
// (ADR 0064, ADR 0069) never reach this module (`portal-print-code-columns.test.ts`).
const TOKEN_COLUMNS = {
  id: portalTokens.id,
  organizationId: portalTokens.organizationId,
  propertyId: portalTokens.propertyId,
  portalId: portalTokens.portalId,
  tokenIdentifier: portalTokens.tokenIdentifier,
  tokenHash: portalTokens.tokenHash,
  tokenKeyVersion: portalTokens.tokenKeyVersion,
  version: portalTokens.version,
  status: portalTokens.status,
  issuedAt: portalTokens.issuedAt,
  gracePeriodEnds: portalTokens.gracePeriodEnds,
  retiredAt: portalTokens.retiredAt,
  revokedAt: portalTokens.revokedAt,
  revokedBy: portalTokens.revokedBy,
  revokedReason: portalTokens.revokedReason,
} as const

const selectTokens = (db: Database) => db.select(TOKEN_COLUMNS).from(portalTokens)
type TokenRow = Awaited<ReturnType<typeof selectTokens>>[number]

function tokenFromRow(row: TokenRow): PortalToken {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    tokenIdentifier: row.tokenIdentifier,
    tokenHash: row.tokenHash,
    tokenKeyVersion: row.tokenKeyVersion,
    version: row.version,
    status: row.status as TokenStatus,
    issuedAt: row.issuedAt,
    gracePeriodEnds: row.gracePeriodEnds,
    retiredAt: row.retiredAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revokedReason: row.revokedReason,
  }
}

// PB2.1 / ADR 0044: a token reaches its portal while it is active, or while a
// rotated token is still inside the grace window that keeps already-printed QR
// codes working. Every management token-status read uses this one predicate so
// they cannot drift.
const resolvableAsOf = (asOf: Date) =>
  or(
    eq(portalTokens.status, 'active'),
    and(eq(portalTokens.status, 'rotating'), gte(portalTokens.gracePeriodEnds, asOf)),
  )

// A rotation writes `gracePeriodEnds` on the outgoing token only, so the newer
// (current) token carries none. The window a reader cares about is the one the
// older, printed code is still inside: the latest end among those older tokens.
// One statement for many Portals, each keyed to its own current version.
async function outgoingGraceEnds(
  db: Database,
  organizationId: OrganizationId,
  current: readonly { portalId: string; version: number }[],
  asOf: Date,
): Promise<ReadonlyMap<string, Date>> {
  if (current.length === 0) return new Map()
  const currentVersion = new Map(current.map((row) => [row.portalId, row.version]))
  const rows = await db
    .select({
      portalId: portalTokens.portalId,
      version: portalTokens.version,
      gracePeriodEnds: portalTokens.gracePeriodEnds,
    })
    .from(portalTokens)
    .where(
      and(
        eq(portalTokens.organizationId, unbrand(organizationId)),
        inArray(portalTokens.portalId, [...currentVersion.keys()]),
        eq(portalTokens.status, 'rotating'),
        gte(portalTokens.gracePeriodEnds, asOf),
      ),
    )
  const latest = new Map<string, Date>()
  for (const row of rows) {
    const current = currentVersion.get(row.portalId)
    if (current === undefined || row.version >= current || row.gracePeriodEnds === null) {
      continue
    }
    const seen = latest.get(row.portalId)
    if (seen === undefined || row.gracePeriodEnds > seen) {
      latest.set(row.portalId, row.gracePeriodEnds)
    }
  }
  return latest
}

// Each Portal's current resolvable token, highest version first: during a
// rotation grace window the outgoing token is also resolvable, but the Portal's
// current token is the newer one. DISTINCT ON keeps that one per Portal.
async function resolvableSummaries(
  db: Database,
  organizationId: OrganizationId,
  portalIds: readonly PortalId[],
  asOf: Date,
) {
  if (portalIds.length === 0) return []
  const rows = await db
    .selectDistinctOn([portalTokens.portalId], {
      portalId: portalTokens.portalId,
      version: portalTokens.version,
      issuedAt: portalTokens.issuedAt,
      gracePeriodEnds: portalTokens.gracePeriodEnds,
      addressKeyVersion: portalTokens.addressEncryptionKeyVersion,
      issuedBy: portalTokens.issuedBy,
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
        inArray(
          portalTokens.portalId,
          portalIds.map((id) => unbrand(id)),
        ),
        resolvableAsOf(asOf),
      ),
    )
    .orderBy(asc(portalTokens.portalId), desc(portalTokens.version))
  // The outgoing grace, for every Portal whose current token carries none
  // of its own, in one extra statement.
  const outgoing = await outgoingGraceEnds(
    db,
    organizationId,
    rows.filter((row) => row.gracePeriodEnds === null),
    asOf,
  )
  return rows.map((row) => ({
    portalId: toPortalId(row.portalId),
    version: row.version,
    issuedAt: row.issuedAt,
    gracePeriodEnds: row.gracePeriodEnds ?? outgoing.get(row.portalId) ?? null,
    hasPublishedAccessArtifact: row.accessArtifactId !== null,
    addressKeyVersion: row.addressKeyVersion,
    issuedBy: row.issuedBy,
  }))
}

export const createPortalTokenRepository = (db: Database): PortalTokenRepository => ({
  findLatestForPortal: async (organizationId, portalId) =>
    trace('portalToken.findLatestForPortal', async () => {
      const [row] = await selectTokens(db)
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
      const [row] = await resolvableSummaries(db, organizationId, [portalId], asOf)
      if (!row) return null
      const { portalId: _portalId, ...summary } = row
      return summary
    }),

  findResolvableSummariesForPortals: async (organizationId, portalIds, asOf) =>
    trace('portalToken.findResolvableSummariesForPortals', () =>
      resolvableSummaries(db, organizationId, portalIds, asOf),
    ),
})
