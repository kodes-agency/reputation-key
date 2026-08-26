import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalUploadIssuances, portals } from '#/shared/db/schema/portal.schema'
import { organizationId, portalId, propertyId, unbrand } from '#/shared/domain/ids'
import type {
  PortalUploadIssuanceStore,
  PortalUploadScope,
} from '../application/ports/portal-upload-issuance-store.port'
import {
  expectedPortalHeroSourceObjectKey,
  isPortalHeroUploadContentType,
  portalUploadMetadataMatches,
  type PortalUploadIssuance,
  type PortalUploadIssuanceState,
} from '../domain/upload-issuance'
import { trace } from '#/shared/observability/trace'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { PortalHeroImageProcessingRequested } from '../domain/events'

const STATES: ReadonlySet<string> = new Set([
  'issued',
  'consumed',
  'finalized',
  'superseded',
  'rejected',
  'expired',
])

type UploadRow = typeof portalUploadIssuances.$inferSelect

function toIssuance(row: UploadRow): PortalUploadIssuance | null {
  if (
    row.purpose !== 'hero_image' ||
    !isPortalHeroUploadContentType(row.contentType) ||
    !STATES.has(row.state)
  ) {
    return null
  }
  const issuance: PortalUploadIssuance = {
    id: row.id,
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    portalId: portalId(row.portalId),
    purpose: row.purpose,
    objectKey: row.objectKey,
    contentType: row.contentType,
    declaredSizeBytes: row.declaredSizeBytes,
    maxSizeBytes: row.maxSizeBytes,
    state: row.state as PortalUploadIssuanceState,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    finalizedAt: row.finalizedAt,
    supersededAt: row.supersededAt,
    rejectedAt: row.rejectedAt,
    expiredAt: row.expiredAt,
    heroDerivativeKey: row.heroDerivativeKey,
    thumbnailDerivativeKey: row.thumbnailDerivativeKey,
    heroImageUrl: row.heroImageUrl,
  }
  return issuance.objectKey === expectedPortalHeroSourceObjectKey(issuance)
    ? issuance
    : null
}

const scopeWhere = (scope: PortalUploadScope) =>
  and(
    eq(portalUploadIssuances.id, scope.issuanceId),
    eq(portalUploadIssuances.organizationId, unbrand(scope.organizationId)),
    eq(portalUploadIssuances.propertyId, unbrand(scope.propertyId)),
    eq(portalUploadIssuances.portalId, unbrand(scope.portalId)),
    eq(portalUploadIssuances.purpose, 'hero_image'),
  )

function assertProcessingRequest(
  scope: PortalUploadScope,
  observedETag: string | null,
  event: PortalHeroImageProcessingRequested,
): void {
  if (
    event.uploadId !== scope.issuanceId ||
    event.organizationId !== scope.organizationId ||
    event.propertyId !== scope.propertyId ||
    event.portalId !== scope.portalId ||
    event.sourceETag !== observedETag
  ) {
    throw new Error('Portal upload processing fact does not match locked scope')
  }
}

async function lockPortal(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  scope: PortalUploadScope,
): Promise<{ heroImageUrl: string | null } | null> {
  const result = await tx.execute(sql`
    SELECT ${portals.heroImageUrl} AS "heroImageUrl"
    FROM ${portals}
    WHERE ${portals.organizationId} = ${unbrand(scope.organizationId)}
      AND ${portals.propertyId} = ${unbrand(scope.propertyId)}
      AND ${portals.id} = ${unbrand(scope.portalId)}
      AND ${portals.deletedAt} IS NULL
    FOR UPDATE
  `)
  const row = result.rows[0]
  if (!row || typeof row !== 'object') return null
  const value = (row as { heroImageUrl?: unknown }).heroImageUrl
  return { heroImageUrl: typeof value === 'string' ? value : null }
}

async function lockIssuance(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  scope: PortalUploadScope,
): Promise<PortalUploadIssuance | null> {
  await tx.execute(sql`
    SELECT ${portalUploadIssuances.id}
    FROM ${portalUploadIssuances}
    WHERE ${portalUploadIssuances.id} = ${scope.issuanceId}
      AND ${portalUploadIssuances.organizationId} = ${unbrand(scope.organizationId)}
      AND ${portalUploadIssuances.propertyId} = ${unbrand(scope.propertyId)}
      AND ${portalUploadIssuances.portalId} = ${unbrand(scope.portalId)}
      AND ${portalUploadIssuances.purpose} = 'hero_image'
    FOR UPDATE
  `)
  const [row] = await tx
    .select()
    .from(portalUploadIssuances)
    .where(scopeWhere(scope))
    .limit(1)
  return row ? toIssuance(row) : null
}

export function createPortalUploadIssuanceStore(db: Database): PortalUploadIssuanceStore {
  return {
    create: async (issuance) =>
      trace('portalUploadIssuance.create', async () => {
        if (issuance.objectKey !== expectedPortalHeroSourceObjectKey(issuance)) {
          throw new Error('Portal upload issuance object key is not server-derived')
        }
        await db.insert(portalUploadIssuances).values({
          id: issuance.id,
          organizationId: unbrand(issuance.organizationId),
          propertyId: unbrand(issuance.propertyId),
          portalId: unbrand(issuance.portalId),
          purpose: issuance.purpose,
          objectKey: issuance.objectKey,
          contentType: issuance.contentType,
          declaredSizeBytes: issuance.declaredSizeBytes,
          maxSizeBytes: issuance.maxSizeBytes,
          state: issuance.state,
          issuedAt: issuance.issuedAt,
          expiresAt: issuance.expiresAt,
          consumedAt: issuance.consumedAt,
          finalizedAt: issuance.finalizedAt,
          supersededAt: issuance.supersededAt,
          rejectedAt: issuance.rejectedAt,
          expiredAt: issuance.expiredAt,
          heroDerivativeKey: issuance.heroDerivativeKey,
          thumbnailDerivativeKey: issuance.thumbnailDerivativeKey,
          heroImageUrl: issuance.heroImageUrl,
        })
      }),

    findScoped: async (scope) =>
      trace('portalUploadIssuance.findScoped', async () => {
        const [row] = await db
          .select()
          .from(portalUploadIssuances)
          .where(scopeWhere(scope))
          .limit(1)
        return row ? toIssuance(row) : null
      }),

    rejectIssued: async (scope, reason, at) =>
      trace('portalUploadIssuance.rejectIssued', async () => {
        const rows = await db
          .update(portalUploadIssuances)
          .set({
            state: reason,
            rejectedAt: reason === 'rejected' ? at : null,
            expiredAt: reason === 'expired' ? at : null,
            updatedAt: at,
          })
          .where(and(scopeWhere(scope), eq(portalUploadIssuances.state, 'issued')))
          .returning({ id: portalUploadIssuances.id })
        return rows.length === 1
      }),

    stage: async (scope, observed, processingRequested, at) =>
      trace('portalUploadIssuance.stage', async () => {
        assertProcessingRequest(scope, observed.sourceETag, processingRequested)
        return db.transaction(async (tx) => {
          const portal = await lockPortal(tx, scope)
          if (!portal) return { outcome: 'not_found' as const }
          const issuance = await lockIssuance(tx, scope)
          if (!issuance) return { outcome: 'not_found' as const }
          if (issuance.state !== 'issued') return { outcome: 'not_issued' as const }
          if (at >= issuance.expiresAt) {
            await tx
              .update(portalUploadIssuances)
              .set({ state: 'expired', expiredAt: at, updatedAt: at })
              .where(scopeWhere(scope))
            return { outcome: 'expired' as const }
          }
          if (!portalUploadMetadataMatches(issuance, observed)) {
            await tx
              .update(portalUploadIssuances)
              .set({ state: 'rejected', rejectedAt: at, updatedAt: at })
              .where(scopeWhere(scope))
            return { outcome: 'metadata_mismatch' as const }
          }

          await tx
            .update(portalUploadIssuances)
            .set({ state: 'superseded', supersededAt: at, updatedAt: at })
            .where(
              and(
                eq(portalUploadIssuances.organizationId, unbrand(scope.organizationId)),
                eq(portalUploadIssuances.portalId, unbrand(scope.portalId)),
                eq(portalUploadIssuances.purpose, 'hero_image'),
                eq(portalUploadIssuances.state, 'consumed'),
              ),
            )
          const staged = await tx
            .update(portalUploadIssuances)
            .set({ state: 'consumed', consumedAt: at, updatedAt: at })
            .where(and(scopeWhere(scope), eq(portalUploadIssuances.state, 'issued')))
            .returning({ id: portalUploadIssuances.id })
          if (staged.length !== 1) {
            throw new Error('Portal upload staging lost its locked issuance')
          }
          await insertOutboxRow(tx, processingRequested, { recordedAt: at })
          return { outcome: 'staged' as const, heroImageUrl: portal.heroImageUrl }
        })
      }),

    findProcessable: async (scope) =>
      trace('portalUploadIssuance.findProcessable', async () => {
        const [row] = await db
          .select()
          .from(portalUploadIssuances)
          .where(and(scopeWhere(scope), eq(portalUploadIssuances.state, 'consumed')))
          .limit(1)
        return row ? toIssuance(row) : null
      }),

    publishDerivative: async (scope, derivative, at) =>
      trace('portalUploadIssuance.publishDerivative', async () =>
        db.transaction(async (tx) => {
          const portal = await lockPortal(tx, scope)
          if (!portal) return { outcome: 'not_found' as const }
          const issuance = await lockIssuance(tx, scope)
          if (!issuance) return { outcome: 'not_found' as const }
          if (issuance.state === 'finalized') {
            return { outcome: 'already_finalized' as const }
          }
          if (issuance.state !== 'consumed') return { outcome: 'stale' as const }

          const expectedHeroKey = `public/portal-heroes/${issuance.id}/hero.webp`
          const expectedThumbnailKey = `public/portal-heroes/${issuance.id}/thumbnail.webp`
          if (
            derivative.heroKey !== expectedHeroKey ||
            derivative.thumbnailKey !== expectedThumbnailKey ||
            derivative.heroKey === issuance.objectKey ||
            derivative.thumbnailKey === issuance.objectKey
          ) {
            throw new Error('Portal derivative keys are not issuance-derived')
          }

          const portalRows = await tx
            .update(portals)
            .set({ heroImageUrl: derivative.heroImageUrl, updatedAt: at })
            .where(
              and(
                eq(portals.organizationId, unbrand(scope.organizationId)),
                eq(portals.propertyId, unbrand(scope.propertyId)),
                eq(portals.id, unbrand(scope.portalId)),
              ),
            )
            .returning({ id: portals.id })
          if (portalRows.length !== 1) {
            throw new Error('Portal upload publication lost its locked Portal')
          }
          const issuanceRows = await tx
            .update(portalUploadIssuances)
            .set({
              state: 'finalized',
              finalizedAt: at,
              heroDerivativeKey: derivative.heroKey,
              thumbnailDerivativeKey: derivative.thumbnailKey,
              heroImageUrl: derivative.heroImageUrl,
              updatedAt: at,
            })
            .where(and(scopeWhere(scope), eq(portalUploadIssuances.state, 'consumed')))
            .returning({ id: portalUploadIssuances.id })
          if (issuanceRows.length !== 1) {
            throw new Error('Portal upload publication lost its locked issuance')
          }
          return {
            outcome: 'published' as const,
            heroImageUrl: derivative.heroImageUrl,
          }
        }),
      ),
  }
}
