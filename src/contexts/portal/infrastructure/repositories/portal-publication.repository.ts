import { and, asc, desc, eq, gte, isNull, lt, lte, max, or, sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import {
  portalLinkCategories,
  portalLinks,
  portalApprovedDestinations,
  portalLocalizedOverrides,
  portalPublicationActivations,
  portalPublicationSnapshots,
  portalPendingContentChanges,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
  portals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
import type {
  PortalPublicationActivationRecord,
  PortalPublicationActivationPage,
  PortalPublicationCursor,
  PortalPublicationRepository,
  PortalPendingContentChange,
  ResolvedPortalPublication,
} from '../../application/ports/portal-publication.repository'
import { verifyPortalPublicationSnapshot } from '../../application/portal-publication-snapshot'
import type {
  PortalPublicationActivation,
  PortalPublicationConfiguration,
  PortalPublicationSnapshot,
  PortalPublicationSource,
} from '../../domain/portal-publication-snapshot'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { PORTAL_LANGUAGE_PACK_VERSIONS } from '../../domain/portal-publication-snapshot'
import type {
  PortalGuestLocale,
  PortalLocalizedContentSnapshot,
} from '../../domain/portal-publication-snapshot'

const jsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const publicationConfigurationBaseSchema = z.object({
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

const localizedContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    shortDescription: z.string().trim().min(1).max(500),
    heroImageUrl: z.string().nullable(),
  })
  .readonly()

const publicationConfigurationSchema = z.discriminatedUnion('schemaVersion', [
  publicationConfigurationBaseSchema
    .extend({
      schemaVersion: z.literal(1),
      guestLocale: z.literal('en'),
      languagePackVersion: z.literal('guest-ui-en-v1'),
    })
    .readonly(),
  publicationConfigurationBaseSchema
    .extend({
      schemaVersion: z.literal(2),
      guestLocale: z.enum(['en', 'bg']),
      languagePackVersion: z.enum(['guest-ui-en-v1', 'guest-ui-bg-v1']),
      localeSet: z
        .array(z.enum(['en', 'bg']))
        .min(1)
        .max(2)
        .readonly(),
      languagePackVersions: z
        .object({
          en: z.literal('guest-ui-en-v1').optional(),
          bg: z.literal('guest-ui-bg-v1').optional(),
        })
        .readonly(),
      localizedContent: z
        .object({
          en: localizedContentSchema.optional(),
          bg: localizedContentSchema.optional(),
        })
        .readonly(),
      brandProfile: z
        .object({
          displayName: z.string().trim().min(1).max(120),
          logoUrl: z.string().nullable(),
          defaultHeroImageUrl: z.string().nullable(),
          primaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
          backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
          textColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
          version: z.number().int().positive(),
        })
        .readonly(),
    })
    .readonly(),
])

type SnapshotRow = typeof portalPublicationSnapshots.$inferSelect
type ActivationRow = typeof portalPublicationActivations.$inferSelect

const activationKindSchema = z.enum(['publish', 'rollback'])
const deactivationReasonSchema = z.enum(['disabled', 'archived', 'replaced']).nullable()
const pendingContentChangeKindSchema = z.enum([
  'portal_configuration',
  'portal_links',
  'property_brand_profile',
  'property_brand_content',
  'portal_localized_override',
  'approved_destination',
])

function activationFromRow(row: ActivationRow): PortalPublicationActivation | null {
  const kind = activationKindSchema.safeParse(row.kind)
  const deactivationReason = deactivationReasonSchema.safeParse(row.deactivationReason)
  if (!kind.success || !deactivationReason.success) return null
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    snapshotId: row.snapshotId,
    activationSequence: row.activationSequence,
    kind: kind.data,
    activatedBy: row.activatedBy,
    activatedAt: row.activatedAt,
    deactivatedAt: row.deactivatedAt,
    deactivationReason: deactivationReason.data,
  }
}

function snapshotFromRow(row: SnapshotRow): PortalPublicationSnapshot | null {
  const parsed = publicationConfigurationSchema.safeParse(row.configuration)
  if (!parsed.success) return null
  if (
    parsed.data.guestLocale !== row.guestLocale ||
    parsed.data.languagePackVersion !== row.languagePackVersion ||
    (parsed.data.schemaVersion === 2 &&
      (canonicalizeRfc8785(parsed.data.localeSet) !==
        canonicalizeRfc8785(row.localeSet) ||
        canonicalizeRfc8785(parsed.data.languagePackVersions) !==
          canonicalizeRfc8785(row.languagePackVersions) ||
        canonicalizeRfc8785(parsed.data.localizedContent) !==
          canonicalizeRfc8785(row.localizedContent) ||
        parsed.data.brandProfile.version !== row.brandProfileVersion))
  ) {
    return null
  }
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

function activationRecordFromRows(
  activationRow: ActivationRow,
  snapshotRow: SnapshotRow,
): PortalPublicationActivationRecord | null {
  const activation = activationFromRow(activationRow)
  const snapshot = snapshotFromRow(snapshotRow)
  return activation && snapshot ? { activation, snapshot } : null
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

  const [organizationResult, categories, links, brandProfiles, brandContents, overrides] =
    await Promise.all([
      // The Better Auth organization table is intentionally outside the
      // Drizzle application schema, so this narrow display-name read is SQL.
      db.execute(
        sql`SELECT name FROM "organization" WHERE id = ${organizationId} LIMIT 1`,
      ),
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
        .select({
          link: portalLinks,
          destinationUri: portalApprovedDestinations.normalizedUri,
          destinationApprovalState: portalApprovedDestinations.approvalState,
        })
        .from(portalLinks)
        .leftJoin(
          portalApprovedDestinations,
          and(
            eq(portalApprovedDestinations.organizationId, portalLinks.organizationId),
            eq(portalApprovedDestinations.propertyId, portalLinks.propertyId),
            eq(portalApprovedDestinations.id, portalLinks.destinationId),
          ),
        )
        .where(
          and(
            eq(portalLinks.organizationId, organizationId),
            eq(portalLinks.portalId, portalId),
          ),
        )
        .orderBy(portalLinks.sortKey, portalLinks.id),
      db
        .select()
        .from(propertyPortalBrandProfiles)
        .where(
          and(
            eq(propertyPortalBrandProfiles.organizationId, organizationId),
            eq(propertyPortalBrandProfiles.propertyId, portal.propertyId),
          ),
        )
        .limit(1),
      db
        .select()
        .from(propertyPortalBrandContents)
        .where(
          and(
            eq(propertyPortalBrandContents.organizationId, organizationId),
            eq(propertyPortalBrandContents.propertyId, portal.propertyId),
          ),
        ),
      db
        .select()
        .from(portalLocalizedOverrides)
        .where(
          and(
            eq(portalLocalizedOverrides.organizationId, organizationId),
            eq(portalLocalizedOverrides.propertyId, portal.propertyId),
            eq(portalLocalizedOverrides.portalId, portalId),
          ),
        ),
    ])
  const organization = organizationResult.rows[0] as { name?: unknown } | undefined
  if (!organization || typeof organization.name !== 'string') return null

  const primaryGuestLocale = portal.primaryGuestLocale === 'bg' ? 'bg' : 'en'
  const additionalGuestLocales = z
    .array(z.enum(['en', 'bg']))
    .safeParse(portal.additionalGuestLocales)
  const localeCandidates: PortalGuestLocale[] = [
    primaryGuestLocale,
    ...(additionalGuestLocales.success ? additionalGuestLocales.data : []),
  ]
  const localeSet: PortalGuestLocale[] = localeCandidates.filter(
    (locale, index, all) => all.indexOf(locale) === index,
  )
  const brand = brandProfiles[0]
  const contentByLocale = new Map(
    brandContents.map((content) => [content.locale, content]),
  )
  const overrideByLocale = new Map(
    overrides.map((override) => [override.locale, override]),
  )
  const resolvedLocalizedContent = Object.fromEntries(
    localeSet.flatMap((locale) => {
      const content = contentByLocale.get(locale)
      if (!content) return []
      const override = overrideByLocale.get(locale)
      return [
        [
          locale,
          {
            title: override?.title ?? content.title,
            shortDescription: override?.shortDescription ?? content.shortDescription,
            heroImageUrl: override?.heroImageUrl ?? brand?.defaultHeroImageUrl ?? null,
          },
        ],
      ]
    }),
  ) as Partial<Record<PortalGuestLocale, PortalLocalizedContentSnapshot>>
  const hasCompleteExperience =
    brand !== undefined &&
    localeSet.length > 0 &&
    localeSet.every((locale) => resolvedLocalizedContent[locale] !== undefined)

  return {
    portal: {
      id: portal.id,
      name: portal.name,
      slug: portal.slug,
      description: portal.description,
      heroImageUrl: portal.heroImageUrl,
      theme: portal.theme as Record<string, string | number | boolean | null> | null,
      organizationName: brand?.displayName ?? organization.name,
    },
    categories: categories.map((category) => ({
      id: category.id,
      title: category.title,
      sortKey: category.sortKey,
    })),
    links: links.flatMap(({ link, destinationUri, destinationApprovalState }) => {
      const url = destinationApprovalState === 'approved' ? destinationUri : null
      return url
        ? [
            {
              id: link.id,
              label: link.label,
              url,
              categoryId: link.categoryId,
              sortKey: link.sortKey,
            },
          ]
        : []
    }),
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    organizationId,
    propertyId: portal.propertyId,
    experience: hasCompleteExperience
      ? {
          primaryGuestLocale,
          localeSet,
          languagePackVersions: PORTAL_LANGUAGE_PACK_VERSIONS,
          localizedContent: resolvedLocalizedContent,
          brandProfile: {
            displayName: brand.displayName,
            logoUrl: brand.logoUrl,
            defaultHeroImageUrl: brand.defaultHeroImageUrl,
            primaryColor: brand.primaryColor,
            backgroundColor: brand.backgroundColor,
            textColor: brand.textColor,
            version: brand.version,
          },
        }
      : undefined,
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

  listActivationHistoryPage: async (organizationId, propertyId, portalId, page) =>
    trace('portalPublication.listActivationHistoryPage', async () => {
      const limit = Number.isSafeInteger(page.limit)
        ? Math.min(50, Math.max(1, page.limit))
        : 20
      const scope = [
        eq(portalPublicationActivations.organizationId, unbrand(organizationId)),
        eq(portalPublicationActivations.propertyId, unbrand(propertyId)),
        eq(portalPublicationActivations.portalId, unbrand(portalId)),
      ] as const
      const selectRecords = () =>
        db
          .select({
            activation: portalPublicationActivations,
            snapshot: portalPublicationSnapshots,
          })
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
      const [pageRows, latestRows, currentRows] = await Promise.all([
        selectRecords()
          .where(
            and(
              ...scope,
              page.beforeSequence === null
                ? undefined
                : lt(
                    portalPublicationActivations.activationSequence,
                    page.beforeSequence,
                  ),
            ),
          )
          .orderBy(desc(portalPublicationActivations.activationSequence))
          .limit(limit + 1),
        selectRecords()
          .where(and(...scope))
          .orderBy(desc(portalPublicationActivations.activationSequence))
          .limit(1),
        selectRecords()
          .where(and(...scope, isNull(portalPublicationActivations.deactivatedAt)))
          .orderBy(desc(portalPublicationActivations.activationSequence))
          .limit(1),
      ])
      const visibleRows = pageRows.slice(0, limit)
      const records = visibleRows.flatMap(({ activation, snapshot }) => {
        const record = activationRecordFromRows(activation, snapshot)
        return record ? [record] : []
      })
      const toRecord = (
        row: (typeof pageRows)[number] | undefined,
      ): PortalPublicationActivationRecord | null =>
        row ? activationRecordFromRows(row.activation, row.snapshot) : null
      return {
        records,
        latest: toRecord(latestRows[0]),
        current: toRecord(currentRows[0]),
        nextCursor:
          pageRows.length > limit
            ? (visibleRows.at(-1)?.activation.activationSequence ?? null)
            : null,
      } satisfies PortalPublicationActivationPage
    }),

  listOpenPendingContentChanges: (organizationId, propertyId, portalId) =>
    trace('portalPublication.listOpenPendingContentChanges', async () => {
      const rows = await db
        .select({
          kind: portalPendingContentChanges.changeKind,
          key: portalPendingContentChanges.changeKey,
          sourceVersion: portalPendingContentChanges.sourceVersion,
          changedAt: portalPendingContentChanges.changedAt,
        })
        .from(portalPendingContentChanges)
        .where(
          and(
            eq(portalPendingContentChanges.organizationId, unbrand(organizationId)),
            eq(portalPendingContentChanges.propertyId, unbrand(propertyId)),
            eq(portalPendingContentChanges.portalId, unbrand(portalId)),
            isNull(portalPendingContentChanges.resolvedAt),
          ),
        )
        .orderBy(
          asc(portalPendingContentChanges.changedAt),
          asc(portalPendingContentChanges.id),
        )
      return rows.flatMap((row): readonly PortalPendingContentChange[] => {
        const kind = pendingContentChangeKindSchema.safeParse(row.kind)
        return kind.success ? [{ ...row, kind: kind.data }] : []
      })
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
