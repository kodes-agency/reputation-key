// The one reader of a Portal's working copy (F4).
//
// Three places need "what would be published from the working rows right now":
// the publication repository (to build the snapshot), the publish transaction
// (to verify that snapshot against the committed rows) and the history use case
// (to tell whether the working copy has moved past what is live). They read the
// same tables through this function, so they cannot disagree about what the
// working copy is. The comparison against a snapshot lives beside it in
// application/portal-working-copy-match.ts.
//
// The LOCK TABLE list lives here too: it names exactly the working-copy tables
// the publish transaction must hold still while it reads them.

import { and, eq, isNull, sql } from 'drizzle-orm'
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
import { parseGuestLocale } from '#/shared/domain/guest-locale'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'
import {
  PORTAL_LANGUAGE_PACK_VERSIONS,
  type PortalGuestLocale,
  type PortalLocalizedContentSnapshot,
  type PortalPublicationSource,
} from '../domain/portal-publication-snapshot'

/** A Database or a transaction: the reader only selects and executes. */
export type PortalWorkingCopyExecutor = Pick<Database, 'select' | 'execute'>

export type PortalWorkingCopyScope = Readonly<{
  organizationId: string
  portalId: string
  /** When given, the Portal must belong to this Property (the command store knows it). */
  propertyId?: string
}>

export type PortalWorkingCopyReadOptions = Readonly<{
  /**
   * Read the organisation's display-name row `FOR SHARE`, so a rename cannot
   * slip in between the read and the commit of a publish transaction.
   */
  lockOrganization?: boolean
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
    sql`LOCK TABLE ${portalLinkCategories}, ${portalLinks} IN SHARE ROW EXCLUSIVE MODE`,
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

async function readLinkRows(executor: PortalWorkingCopyExecutor, portal: PortalRow) {
  const { organizationId, id: portalId } = portal
  const categories = await executor
    .select()
    .from(portalLinkCategories)
    .where(
      and(
        eq(portalLinkCategories.organizationId, organizationId),
        eq(portalLinkCategories.portalId, portalId),
      ),
    )
    .orderBy(portalLinkCategories.sortKey, portalLinkCategories.id)
  const links = await executor
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
    .orderBy(portalLinks.sortKey, portalLinks.id)
  return { categories, links }
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

// Sequential on purpose: the executor may be a single transaction client,
// which must not have a second query issued while one is in flight.
async function readWorkingRows(
  executor: PortalWorkingCopyExecutor,
  portal: PortalRow,
  options: PortalWorkingCopyReadOptions,
) {
  const lock = options.lockOrganization ? sql` FOR SHARE` : sql``
  // The Better Auth organization table is intentionally outside the Drizzle
  // application schema, so this narrow display-name read is SQL.
  const organization = await executor.execute(
    sql`SELECT name FROM "organization" WHERE id = ${portal.organizationId} LIMIT 1${lock}`,
  )
  return {
    organization,
    ...(await readLinkRows(executor, portal)),
    ...(await readExperienceRows(executor, portal)),
  }
}

type WorkingRows = Awaited<ReturnType<typeof readWorkingRows>>
type BrandRow = NonNullable<WorkingRows['brand']>

function resolveLocalizedContent(
  localeSet: readonly PortalGuestLocale[],
  brand: BrandRow | undefined,
  contents: WorkingRows['contents'],
  overrides: WorkingRows['overrides'],
): Partial<Record<PortalGuestLocale, PortalLocalizedContentSnapshot>> {
  const contentByLocale = new Map(contents.map((content) => [content.locale, content]))
  const overrideByLocale = new Map(
    overrides.map((override) => [override.locale, override]),
  )
  return Object.fromEntries(
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
}

function readExperience(
  primaryGuestLocale: PortalGuestLocale,
  localeSet: readonly PortalGuestLocale[],
  rows: WorkingRows,
): PortalPublicationSource['experience'] {
  const brand = rows.brand
  const localizedContent = resolveLocalizedContent(
    localeSet,
    brand,
    rows.contents,
    rows.overrides,
  )
  const isComplete =
    brand !== undefined &&
    localeSet.length > 0 &&
    localeSet.every((locale) => localizedContent[locale] !== undefined)
  if (!isComplete) return undefined
  return {
    primaryGuestLocale,
    localeSet,
    languagePackVersions: PORTAL_LANGUAGE_PACK_VERSIONS,
    localizedContent,
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
}

function readLinks(rows: WorkingRows['links']): PortalPublicationSource['links'] {
  return rows.flatMap(({ link, destinationUri, destinationApprovalState }) => {
    // Only an approved Property destination is publishable; a raw legacy
    // address or a pending or disabled destination is left out.
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
  })
}

/**
 * The working copy of one Portal, or null when it does not resolve: the Portal
 * is missing, deleted or in another organisation or Property, its stored
 * locales are corrupt, or the organisation has no display name. `experience` is
 * absent until the Brand Profile and every enabled locale are complete.
 */
export async function readPortalWorkingCopy(
  executor: PortalWorkingCopyExecutor,
  scope: PortalWorkingCopyScope,
  options: PortalWorkingCopyReadOptions = {},
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

  const rows = await readWorkingRows(executor, portal, options)
  const organization = rows.organization.rows[0] as { name?: unknown } | undefined
  if (!organization || typeof organization.name !== 'string') return null

  const localeSet: PortalGuestLocale[] = [
    primaryGuestLocale,
    ...additionalGuestLocales.data,
  ].filter((locale, index, all) => all.indexOf(locale) === index)
  return {
    portal: {
      id: portal.id,
      name: portal.name,
      slug: portal.slug,
      description: portal.description,
      heroImageUrl: portal.heroImageUrl,
      theme: portal.theme as Record<string, string | number | boolean | null> | null,
      organizationName: rows.brand?.displayName ?? organization.name,
    },
    categories: rows.categories.map((category) => ({
      id: category.id,
      title: category.title,
      sortKey: category.sortKey,
    })),
    links: readLinks(rows.links),
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    organizationId: scope.organizationId,
    propertyId: portal.propertyId,
    experience: readExperience(primaryGuestLocale, localeSet, rows),
  }
}
