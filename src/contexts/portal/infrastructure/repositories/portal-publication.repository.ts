import { and, desc, eq, gte, isNull, lte, max, or, sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import {
  portalLinkCategories,
  portalLinks,
  portalPublicationActivations,
  portalPublicationSnapshots,
  portals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
import type {
  PortalPublicationCursor,
  PortalPublicationRepository,
  ResolvedPortalPublication,
} from '../../application/ports/portal-publication.repository'
import { verifyPortalPublicationSnapshot } from '../../application/portal-publication-snapshot'
import type {
  PortalPublicationConfiguration,
  PortalPublicationSnapshot,
  PortalPublicationSource,
} from '../../domain/portal-publication-snapshot'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

const jsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const publicationConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    guestLocale: z.literal('en'),
    languagePackVersion: z.literal('guest-ui-en-v1'),
    portal: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        slug: z.string().min(1),
        description: z.string().nullable(),
        heroImageUrl: z.string().nullable(),
        theme: z.record(z.string(), jsonScalarSchema).nullable(),
        organizationName: z.string().min(1),
      })
      .readonly(),
    categories: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string(),
            sortKey: z.string(),
          })
          .readonly(),
      )
      .readonly(),
    links: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            url: z.url({ protocol: /^https$/u }),
            categoryId: z.string().nullable(),
            sortKey: z.string(),
          })
          .readonly(),
      )
      .readonly(),
    reviewGateway: z
      .object({
        privateFeedbackThreshold: z.number().int().min(1).max(5),
        googleReview: z
          .object({
            status: z.literal('available'),
            uri: z.url({ protocol: /^https$/u }),
          })
          .readonly(),
      })
      .readonly(),
    googleReviewBinding: z
      .object({
        retrievedAt: z.iso.datetime({ offset: true }),
        sourceEpoch: z.number().int().min(0),
        profileVersion: z.number().int().min(1),
      })
      .readonly(),
  })
  .readonly()

type SnapshotRow = typeof portalPublicationSnapshots.$inferSelect

function snapshotFromRow(row: SnapshotRow): PortalPublicationSnapshot | null {
  const parsed = publicationConfigurationSchema.safeParse(row.configuration)
  if (!parsed.success) return null
  const snapshot: PortalPublicationSnapshot = {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    version: row.version,
    configurationDigest: row.configurationDigest,
    configuration: parsed.data as PortalPublicationConfiguration,
    destinationUri: row.destinationUri,
    destinationRetrievedAt: row.destinationRetrievedAt,
    destinationSourceEpoch: row.destinationSourceEpoch,
    destinationProfileVersion: row.destinationProfileVersion,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
  return verifyPortalPublicationSnapshot(snapshot) ? snapshot : null
}

async function loadWorkingCopy(
  db: Database,
  organizationId: string,
  portalId: string,
): Promise<PortalPublicationSource | null> {
  const [portal] = await db
    .select()
    .from(portals)
    .where(
      and(
        eq(portals.organizationId, organizationId),
        eq(portals.id, portalId),
        isNull(portals.deletedAt),
      ),
    )
    .limit(1)
  if (!portal) return null

  const [organizationResult, categories, links] = await Promise.all([
    // The Better Auth organization table is intentionally outside the
    // Drizzle application schema, so this narrow display-name read is SQL.
    db.execute(sql`SELECT name FROM "organization" WHERE id = ${organizationId} LIMIT 1`),
    db
      .select()
      .from(portalLinkCategories)
      .where(
        and(
          eq(portalLinkCategories.organizationId, organizationId),
          eq(portalLinkCategories.portalId, portalId),
        ),
      )
      .orderBy(portalLinkCategories.sortKey, portalLinkCategories.id),
    db
      .select()
      .from(portalLinks)
      .where(
        and(
          eq(portalLinks.organizationId, organizationId),
          eq(portalLinks.portalId, portalId),
        ),
      )
      .orderBy(portalLinks.sortKey, portalLinks.id),
  ])
  const organization = organizationResult.rows[0] as { name?: unknown } | undefined
  if (!organization || typeof organization.name !== 'string') return null

  return {
    portal: {
      id: portal.id,
      name: portal.name,
      slug: portal.slug,
      description: portal.description,
      heroImageUrl: portal.heroImageUrl,
      theme: portal.theme as Record<string, string | number | boolean | null> | null,
      organizationName: organization.name,
    },
    categories: categories.map((category) => ({
      id: category.id,
      title: category.title,
      sortKey: category.sortKey,
    })),
    links: links.map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      categoryId: link.categoryId,
      sortKey: link.sortKey,
    })),
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    organizationId,
    propertyId: portal.propertyId,
  }
}

const resolvableTokenAsOf = (asOf: Date) =>
  or(
    eq(portalTokens.status, 'active'),
    and(eq(portalTokens.status, 'rotating'), gte(portalTokens.gracePeriodEnds, asOf)),
  )

export const createPortalPublicationRepository = (
  db: Database,
): PortalPublicationRepository => ({
  loadWorkingCopy: (organizationId, portalId) =>
    trace('portalPublication.loadWorkingCopy', () =>
      loadWorkingCopy(db, unbrand(organizationId), unbrand(portalId)),
    ),

  getCursor: async (organizationId, portalId) =>
    trace('portalPublication.getCursor', async () => {
      const [snapshotRows, activationRows] = await Promise.all([
        db
          .select({ value: max(portalPublicationSnapshots.version) })
          .from(portalPublicationSnapshots)
          .where(
            and(
              eq(portalPublicationSnapshots.organizationId, unbrand(organizationId)),
              eq(portalPublicationSnapshots.portalId, unbrand(portalId)),
            ),
          ),
        db
          .select({ value: max(portalPublicationActivations.activationSequence) })
          .from(portalPublicationActivations)
          .where(
            and(
              eq(portalPublicationActivations.organizationId, unbrand(organizationId)),
              eq(portalPublicationActivations.portalId, unbrand(portalId)),
            ),
          ),
      ])
      return {
        nextSnapshotVersion: (snapshotRows[0]?.value ?? 0) + 1,
        nextActivationSequence: (activationRows[0]?.value ?? 0) + 1,
      } satisfies PortalPublicationCursor
    }),

  findSnapshotByVersion: async (organizationId, portalId, version) =>
    trace('portalPublication.findSnapshotByVersion', async () => {
      const [row] = await db
        .select()
        .from(portalPublicationSnapshots)
        .where(
          and(
            eq(portalPublicationSnapshots.organizationId, unbrand(organizationId)),
            eq(portalPublicationSnapshots.portalId, unbrand(portalId)),
            eq(portalPublicationSnapshots.version, version),
          ),
        )
        .limit(1)
      return row ? snapshotFromRow(row) : null
    }),

  findActiveForPortal: async (organizationId, portalId) =>
    trace('portalPublication.findActiveForPortal', async () => {
      const [row] = await db
        .select({ snapshot: portalPublicationSnapshots })
        .from(portalPublicationActivations)
        .innerJoin(
          portalPublicationSnapshots,
          and(
            eq(
              portalPublicationSnapshots.organizationId,
              portalPublicationActivations.organizationId,
            ),
            eq(
              portalPublicationSnapshots.propertyId,
              portalPublicationActivations.propertyId,
            ),
            eq(
              portalPublicationSnapshots.portalId,
              portalPublicationActivations.portalId,
            ),
            eq(portalPublicationSnapshots.id, portalPublicationActivations.snapshotId),
          ),
        )
        .where(
          and(
            eq(portalPublicationActivations.organizationId, unbrand(organizationId)),
            eq(portalPublicationActivations.portalId, unbrand(portalId)),
            isNull(portalPublicationActivations.deactivatedAt),
          ),
        )
        .orderBy(desc(portalPublicationActivations.activationSequence))
        .limit(1)
      return row ? snapshotFromRow(row.snapshot) : null
    }),

  resolveActiveByTokenDigest: async (digest, asOf) =>
    trace('portalPublication.resolveActiveByTokenDigest', async () => {
      const [row] = await db
        .select({
          tokenOrganizationId: portalTokens.organizationId,
          tokenPropertyId: portalTokens.propertyId,
          tokenPortalId: portalTokens.portalId,
          tokenVersion: portalTokens.version,
          snapshot: portalPublicationSnapshots,
        })
        .from(portalTokens)
        .innerJoin(
          portals,
          and(
            eq(portals.organizationId, portalTokens.organizationId),
            eq(portals.propertyId, portalTokens.propertyId),
            eq(portals.id, portalTokens.portalId),
          ),
        )
        .innerJoin(
          portalPublicationActivations,
          and(
            eq(portalPublicationActivations.organizationId, portalTokens.organizationId),
            eq(portalPublicationActivations.propertyId, portalTokens.propertyId),
            eq(portalPublicationActivations.portalId, portalTokens.portalId),
            isNull(portalPublicationActivations.deactivatedAt),
          ),
        )
        .innerJoin(
          portalPublicationSnapshots,
          and(
            eq(
              portalPublicationSnapshots.organizationId,
              portalPublicationActivations.organizationId,
            ),
            eq(
              portalPublicationSnapshots.propertyId,
              portalPublicationActivations.propertyId,
            ),
            eq(
              portalPublicationSnapshots.portalId,
              portalPublicationActivations.portalId,
            ),
            eq(portalPublicationSnapshots.id, portalPublicationActivations.snapshotId),
          ),
        )
        .where(
          and(
            eq(portalTokens.tokenIdentifier, digest.tokenIdentifier),
            eq(portalTokens.tokenHash, digest.tokenHash),
            eq(portalTokens.tokenKeyVersion, digest.tokenKeyVersion),
            resolvableTokenAsOf(asOf),
            lte(portalPublicationActivations.activatedAt, asOf),
            eq(portals.publicationState, 'published'),
            isNull(portals.deletedAt),
          ),
        )
        .orderBy(desc(portalPublicationActivations.activationSequence))
        .limit(1)
      if (!row) return null
      const snapshot = snapshotFromRow(row.snapshot)
      if (!snapshot) return null
      return {
        token: {
          organizationId: row.tokenOrganizationId,
          propertyId: row.tokenPropertyId,
          portalId: row.tokenPortalId,
          version: row.tokenVersion,
        },
        snapshot,
      } satisfies ResolvedPortalPublication
    }),
})
