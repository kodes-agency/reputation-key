// The one reader of a Portal's working copy (F4).
//
// Three places need "what would be published from the working rows right now":
// the publication repository (to build the snapshot), the publish transaction
// (to verify that snapshot against the committed rows) and the history use case
// (to tell whether the working copy has moved past what is live). They read the
// same tables through this function, so they cannot disagree about what the
// working copy is. The comparison against a snapshot lives beside it in
// application/portal-working-copy-match.ts, and what a source makes of itself
// (fallbacks, blockers) in domain/portal-publication-source.ts.
//
// The reader gathers facts and applies no policy: a text nobody wrote is null
// here, an image that may no longer be served is absent, and a Property with no
// Brand Profile has no look. Filling those gaps is the resolver's job, so the
// same rule applies whether Publish, the comparison or a preview asks.
//
// The LOCK TABLE list lives here too: it names exactly the working-copy tables
// the publish transaction must hold still while it reads them.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod/v4'
import type { Database } from '#/shared/db'
import {
  portalApprovedDestinations,
  portalLinkCategories,
  portalLinks,
  portalLocalizedOverrides,
  portals,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { portalLinkTexts } from '#/shared/db/schema/portal-localization.schema'
import { portalMediaAssets } from '#/shared/db/schema/portal-assets.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { parseGuestLocale, type GuestLocale } from '#/shared/domain/guest-locale'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'
import {
  resolveLinkTexts,
  type PortalLinkTextProvenance,
  type StoredPortalLinkText,
} from '../domain/portal-linktree'
import type {
  PortalPublicationSource,
  PublicationLink,
  PublicationLook,
  PublicationMedia,
  PublicationWording,
} from '../domain/portal-publication-source'

/** A Database or a transaction: the reader only selects. */
export type PortalWorkingCopyExecutor = Pick<Database, 'select'>

export type PortalWorkingCopyScope = Readonly<{
  organizationId: string
  portalId: string
  /** When given, the Portal must belong to this Property (the command store knows it). */
  propertyId?: string
}>

/**
 * Holds the working-copy child tables still for the rest of the transaction.
 * Every content path locks the Portal aggregate first (ADR 0060); taking these
 * table locks second keeps that order while stopping child writers from
 * crossing the committed comparison of a publish.
 */
export async function lockPortalWorkingCopyTables(
  tx: Pick<Database, 'execute'>,
): Promise<void> {
  await tx.execute(
    sql`LOCK TABLE ${portalLinkCategories}, ${portalLinks}, ${portalLinkTexts} IN SHARE ROW EXCLUSIVE MODE`,
  )
}

type PortalRow = typeof portals.$inferSelect

async function readPortalRow(
  executor: PortalWorkingCopyExecutor,
  scope: PortalWorkingCopyScope,
): Promise<PortalRow | undefined> {
  const [portal] = await executor
    .select()
    .from(portals)
    .where(
      and(
        eq(portals.organizationId, scope.organizationId),
        eq(portals.id, scope.portalId),
        ...(scope.propertyId === undefined
          ? []
          : [eq(portals.propertyId, scope.propertyId)]),
        isNull(portals.deletedAt),
      ),
    )
    .limit(1)
  return portal
}

/** The links in guest order (category, then the link's own order), with their approval. */
async function readLinkRows(executor: PortalWorkingCopyExecutor, portal: PortalRow) {
  const { organizationId, id: portalId } = portal
  return executor
    .select({
      link: portalLinks,
      destinationUri: portalApprovedDestinations.normalizedUri,
      destinationApprovalState: portalApprovedDestinations.approvalState,
    })
    .from(portalLinks)
    .innerJoin(
      portalLinkCategories,
      and(
        eq(portalLinkCategories.organizationId, portalLinks.organizationId),
        eq(portalLinkCategories.portalId, portalLinks.portalId),
        eq(portalLinkCategories.id, portalLinks.categoryId),
      ),
    )
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
    .orderBy(
      portalLinkCategories.sortKey,
      portalLinkCategories.id,
      portalLinks.sortKey,
      portalLinks.id,
    )
}

async function readLinkTextRows(executor: PortalWorkingCopyExecutor, portal: PortalRow) {
  return executor
    .select()
    .from(portalLinkTexts)
    .where(
      and(
        eq(portalLinkTexts.organizationId, portal.organizationId),
        eq(portalLinkTexts.portalId, portal.id),
      ),
    )
}

async function readExperienceRows(
  executor: PortalWorkingCopyExecutor,
  portal: PortalRow,
) {
  const { organizationId, id: portalId, propertyId } = portal
  const [brand] = await executor
    .select()
    .from(propertyPortalBrandProfiles)
    .where(
      and(
        eq(propertyPortalBrandProfiles.organizationId, organizationId),
        eq(propertyPortalBrandProfiles.propertyId, propertyId),
      ),
    )
    .limit(1)
  const contents = await executor
    .select()
    .from(propertyPortalBrandContents)
    .where(
      and(
        eq(propertyPortalBrandContents.organizationId, organizationId),
        eq(propertyPortalBrandContents.propertyId, propertyId),
      ),
    )
  const overrides = await executor
    .select()
    .from(portalLocalizedOverrides)
    .where(
      and(
        eq(portalLocalizedOverrides.organizationId, organizationId),
        eq(portalLocalizedOverrides.propertyId, propertyId),
        eq(portalLocalizedOverrides.portalId, portalId),
      ),
    )
  return { brand, contents, overrides }
}

/** The Property's time zone, which the page reads deadlines in. */
async function readTimeZone(
  executor: PortalWorkingCopyExecutor,
  portal: PortalRow,
): Promise<string | null> {
  const [property] = await executor
    .select({ timezone: properties.timezone })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, portal.organizationId),
        eq(properties.id, portal.propertyId),
      ),
    )
    .limit(1)
  return property?.timezone ?? null
}

/** The stored size of every image the working copy names that may still be served. */
async function readServableMedia(
  executor: PortalWorkingCopyExecutor,
  portal: PortalRow,
  assetIds: readonly string[],
): Promise<ReadonlyMap<string, PublicationMedia>> {
  if (assetIds.length === 0) return new Map()
  const rows = await executor
    .select({
      id: portalMediaAssets.id,
      width: portalMediaAssets.width,
      height: portalMediaAssets.height,
    })
    .from(portalMediaAssets)
    .where(
      and(
        eq(portalMediaAssets.organizationId, portal.organizationId),
        eq(portalMediaAssets.propertyId, portal.propertyId),
        eq(portalMediaAssets.status, 'active'),
        inArray(portalMediaAssets.id, [...assetIds]),
      ),
    )
  return new Map(
    rows.map((row) => [
      row.id,
      { assetId: row.id, width: row.width, height: row.height },
    ]),
  )
}

// Sequential on purpose: the executor may be a single transaction client,
// which must not have a second query issued while one is in flight.
async function readWorkingRows(executor: PortalWorkingCopyExecutor, portal: PortalRow) {
  const timeZone = await readTimeZone(executor, portal)
  const links = await readLinkRows(executor, portal)
  const linkTexts = await readLinkTextRows(executor, portal)
  const experience = await readExperienceRows(executor, portal)
  const assetIds = [
    experience.brand?.logoAssetId,
    experience.brand?.heroAssetId,
    ...links.map(({ link }) => link.imageAssetId),
  ].filter((id): id is string => typeof id === 'string')
  const media = await readServableMedia(executor, portal, [...new Set(assetIds)])
  return { timeZone, links, linkTexts, media, ...experience }
}

type WorkingRows = Awaited<ReturnType<typeof readWorkingRows>>
type BrandRow = NonNullable<WorkingRows['brand']>

/** What each enabled language was given, as written: a text nobody wrote is null. */
function resolveWording(
  localeSet: readonly GuestLocale[],
  rows: WorkingRows,
): Partial<Record<GuestLocale, PublicationWording>> {
  const contentByLocale = new Map(
    rows.contents.map((content) => [content.locale, content]),
  )
  const overrideByLocale = new Map(
    rows.overrides.map((override) => [override.locale, override]),
  )
  return Object.fromEntries(
    localeSet.map((locale): [GuestLocale, PublicationWording] => {
      const content = contentByLocale.get(locale)
      const override = overrideByLocale.get(locale)
      // A language has wording only when the Property wrote some for it; a
      // Portal override then replaces it.
      return [
        locale,
        {
          title: content ? (override?.title ?? content.title) : null,
          shortDescription: content
            ? (override?.shortDescription ?? content.shortDescription)
            : null,
          heroAlt: content?.heroAltText ?? null,
          linktreeTitle: override?.linktreeTitle ?? null,
        },
      ]
    }),
  )
}

function readLook(
  brand: BrandRow | undefined,
  media: WorkingRows['media'],
): PublicationLook | null {
  if (!brand) return null
  const hero = brand.heroAssetId ? media.get(brand.heroAssetId) : undefined
  const logo = brand.logoAssetId ? media.get(brand.logoAssetId) : undefined
  return {
    displayName: brand.displayName,
    wordmark: brand.wordmark,
    accentColour: brand.primaryColor,
    backgroundColour: brand.backgroundColor,
    backgroundMode: brand.backgroundMode === 'manual' ? 'manual' : 'auto',
    lookVersion: brand.lookVersion,
    logo: logo ?? null,
    hero:
      hero && brand.heroFocalX !== null && brand.heroFocalY !== null
        ? { ...hero, focalX: brand.heroFocalX, focalY: brand.heroFocalY }
        : null,
  }
}

const provenanceOf = (value: string | null): PortalLinkTextProvenance | null =>
  value === 'ai_draft' ? 'ai_draft' : null

/**
 * The links a guest can open, in order, each with its wording per language. A
 * link with no row for the primary language reads its own label there, the way
 * every other reader of link texts does.
 */
function readLinks(
  rows: WorkingRows,
  primaryGuestLocale: GuestLocale,
): readonly PublicationLink[] {
  // Only an approved Property destination is publishable; a raw legacy
  // address or a pending or disabled destination is left out.
  const approved = rows.links.flatMap(
    ({ link, destinationUri, destinationApprovalState }) =>
      destinationApprovalState === 'approved' && destinationUri
        ? [{ link, url: destinationUri }]
        : [],
  )
  const stored = rows.linkTexts.flatMap((row): StoredPortalLinkText[] => {
    const locale = parseGuestLocale(row.locale)
    return locale
      ? [
          {
            linkId: row.linkId,
            locale,
            label: row.label,
            line: row.line,
            provenance: provenanceOf(row.provenance),
            version: row.version,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt,
          },
        ]
      : []
  })
  const texts = resolveLinkTexts({
    links: approved.map(({ link }) => ({ id: link.id, label: link.label })),
    texts: stored,
    primaryLocale: primaryGuestLocale,
  })
  return approved.map(({ link, url }) => ({
    id: link.id,
    url,
    iconKey: link.iconKey,
    imageAssetId:
      link.imageAssetId && rows.media.has(link.imageAssetId) ? link.imageAssetId : null,
    texts: Object.fromEntries(
      texts
        .filter((text) => text.linkId === link.id)
        .map((text) => [
          text.locale,
          { label: text.label, line: text.line, provenance: text.provenance },
        ]),
    ),
  }))
}

/**
 * The working copy of one Portal, or null when it does not resolve: the Portal
 * is missing, deleted or in another organisation or Property, or its stored
 * locales are corrupt. Everything else, including a Property with no Brand
 * Profile or a language with no wording, is a fact the source reports and the
 * resolver judges.
 */
export async function readPortalWorkingCopy(
  executor: PortalWorkingCopyExecutor,
  scope: PortalWorkingCopyScope,
): Promise<PortalPublicationSource | null> {
  const portal = await readPortalRow(executor, scope)
  if (!portal) return null
  // The working copy's locales are read as stored: an unknown one is a corrupt
  // row, so the source does not resolve at all rather than publishing English.
  const primaryGuestLocale = parseGuestLocale(portal.primaryGuestLocale)
  const additionalGuestLocales = z
    .array(guestLocaleSchema)
    .safeParse(portal.additionalGuestLocales)
  if (!primaryGuestLocale || !additionalGuestLocales.success) return null

  const rows = await readWorkingRows(executor, portal)
  const localeSet: GuestLocale[] = [
    primaryGuestLocale,
    ...additionalGuestLocales.data,
  ].filter((locale, index, all) => all.indexOf(locale) === index)
  return {
    organizationId: scope.organizationId,
    propertyId: portal.propertyId,
    portal: { id: portal.id, name: portal.name, slug: portal.slug },
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    primaryGuestLocale,
    localeSet,
    linktreeEnabled: portal.linktreeEnabled,
    timeZone: rows.timeZone,
    look: readLook(rows.brand, rows.media),
    wording: resolveWording(localeSet, rows),
    links: readLinks(rows, primaryGuestLocale),
  }
}
