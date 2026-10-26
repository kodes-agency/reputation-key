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
// The one thing it does lay over the Property's rows is a Portal's own look
// (ADR 0070): the Portal's `portal_look_overrides` row is merged into the Brand
// Profile and the photo descriptions BEFORE the images are looked up, so the
// Portal's own photo and logo go through the same check as the Property's (an
// active image of this Property, uploaded for that slot) and a taken-down own
// photo reads as no photo, never as the Property's. A Portal with no row is read
// exactly as it was before Portals could have a look of their own. The Portal's
// effective look version rides in the merged profile, so a change of the row
// makes a publish in flight fail its in-transaction verification.
//
// The reader takes no lock of its own. A publish reads through it after it has
// locked the Portal row, and that row is what holds the working copy still:
// every command that writes a link, a category or a link text updates the
// Portal row first, under a compare-and-set on its revision
// (`fencePortalContent`, ADR 0060), so it waits for the publish and is then
// refused. Publishing used to lock the three link tables as well. That lock
// added nothing for those writers and made every Organization's link writes
// and publishes wait for each other (it conflicts with the table lock any
// INSERT, UPDATE or DELETE holds until it commits). A writer that does not
// take the Portal row first would not be stopped by anything here: do not add
// one.

import { and, eq, inArray, isNull } from 'drizzle-orm'
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
import { portalLookOverrides } from '#/shared/db/schema/portal-look.schema'
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
import {
  applyPortalLook,
  lookSourcesOf,
  portalLookOverrideOf,
  withPortalHeroAlt,
} from '../domain/portal-look'
import {
  PORTAL_MEDIA_REFERENCE_SLOTS,
  type PortalMediaReferenceSlot,
} from '../domain/portal-media-asset'
import type { PortalWorkingCopyWithLook } from '../application/ports/portal-publication.repository'
import { hasPropertyWording } from '../domain/property-wording'

/** A Database or a transaction: the reader only selects. */
export type PortalWorkingCopyExecutor = Pick<Database, 'select'>

export type PortalWorkingCopyScope = Readonly<{
  organizationId: string
  portalId: string
  /** When given, the Portal must belong to this Property (the command store knows it). */
  propertyId?: string
}>

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
  const [lookRow] = await executor
    .select()
    .from(portalLookOverrides)
    .where(
      and(
        eq(portalLookOverrides.organizationId, organizationId),
        eq(portalLookOverrides.propertyId, propertyId),
        eq(portalLookOverrides.portalId, portalId),
      ),
    )
    .limit(1)
  // A Property with no Brand Profile has no look to lay a Portal's over (the
  // writers refuse to make a row then), so a row found anyway is ignored.
  const lookOverride =
    brand === undefined || lookRow === undefined ? null : portalLookOverrideOf(lookRow)
  return { brand, contents, overrides, lookOverride }
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

/** An image that may be served and what it was uploaded for, which the slot it fills must match. */
type ServableMedia = PublicationMedia & Readonly<{ purpose: string }>

/** The stored size and purpose of every image the working copy names that may still be served. */
async function readServableMedia(
  executor: PortalWorkingCopyExecutor,
  portal: PortalRow,
  assetIds: readonly string[],
): Promise<ReadonlyMap<string, ServableMedia>> {
  if (assetIds.length === 0) return new Map()
  const rows = await executor
    .select({
      id: portalMediaAssets.id,
      purpose: portalMediaAssets.purpose,
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
      { assetId: row.id, purpose: row.purpose, width: row.width, height: row.height },
    ]),
  )
}

/**
 * The image a slot of the look may show: servable, and uploaded for that slot
 * (the draft preview asks `canReferencePortalMediaAsset` the same). The writers
 * check the slot too; the reader does not trust them with what guests see.
 */
function mediaForSlot(
  media: ReadonlyMap<string, ServableMedia>,
  slot: PortalMediaReferenceSlot,
  assetId: string | null,
): PublicationMedia | undefined {
  const asset = assetId === null ? undefined : media.get(assetId)
  if (asset?.purpose !== PORTAL_MEDIA_REFERENCE_SLOTS[slot]) return undefined
  return { assetId: asset.assetId, width: asset.width, height: asset.height }
}

// Sequential on purpose: the executor may be a single transaction client,
// which must not have a second query issued while one is in flight.
async function readWorkingRows(executor: PortalWorkingCopyExecutor, portal: PortalRow) {
  const timeZone = await readTimeZone(executor, portal)
  const links = await readLinkRows(executor, portal)
  const linkTexts = await readLinkTextRows(executor, portal)
  const rows = await readExperienceRows(executor, portal)
  // The Portal's own look is laid over the Property's rows before any image id
  // is collected, so its own photo and logo are looked up like the Property's.
  const { lookOverride } = rows
  const brand =
    rows.brand === undefined ? undefined : applyPortalLook(rows.brand, lookOverride)
  const contents = withPortalHeroAlt(rows.contents, lookOverride)
  const assetIds = [
    brand?.logoAssetId,
    brand?.heroAssetId,
    ...links.map(({ link }) => link.imageAssetId),
  ].filter((id): id is string => typeof id === 'string')
  const media = await readServableMedia(executor, portal, [...new Set(assetIds)])
  return {
    timeZone,
    links,
    linkTexts,
    media,
    brand,
    contents,
    overrides: rows.overrides,
    lookOverride,
  }
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
      // A language has wording only when the Property wrote some for it (a row
      // holding just the photograph's description is not wording); a Portal
      // override then replaces it.
      const wording = hasPropertyWording(content) ? content : undefined
      return [
        locale,
        {
          title: wording ? (override?.title ?? wording.title) : null,
          shortDescription: wording
            ? (override?.shortDescription ?? wording.shortDescription)
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
  const hero = mediaForSlot(media, 'brand_hero', brand.heroAssetId)
  const logo = mediaForSlot(media, 'brand_logo', brand.logoAssetId)
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
 * The working copy of one Portal and where its look groups come from (ADR
 * 0070), or null when it does not resolve: the Portal is missing, deleted or in
 * another organisation or Property, or its stored locales are corrupt.
 * Everything else, including a Property with no Brand Profile or a language
 * with no wording, is a fact the source reports and the resolver judges. A
 * Portal with no override row follows the whole Property look.
 */
export async function readPortalWorkingCopyWithLook(
  executor: PortalWorkingCopyExecutor,
  scope: PortalWorkingCopyScope,
): Promise<PortalWorkingCopyWithLook | null> {
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
    source: {
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
    },
    lookSources: lookSourcesOf(rows.lookOverride),
  }
}

/** The working copy of one Portal, or null exactly when `readPortalWorkingCopyWithLook` is. */
export async function readPortalWorkingCopy(
  executor: PortalWorkingCopyExecutor,
  scope: PortalWorkingCopyScope,
): Promise<PortalPublicationSource | null> {
  const workingCopy = await readPortalWorkingCopyWithLook(executor, scope)
  return workingCopy === null ? null : workingCopy.source
}
