// Portal context — the `portal_look_overrides` rows (ADR 0070).
//
// A Portal with no row follows the whole Property look and reads as null.
// Every statement names the Organization, and each one that can also name the
// Property does, so a row of another tenant or another Property is never read
// or written. The composite foreign keys hold writes to a Portal and to images
// of the same Property.
//
// A save takes the Property's publication lock and then the Portal row, the
// order publish takes them, so a save and a publish of the same Portal run one
// after the other and a publish never builds from half a save. What guests
// would see differently is decided by `nextPortalLook` from the Brand Profile
// as it stands under that lock; only that is recorded, as page edits of this
// Portal alone, so the change waits for this Portal's own publish.

import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLookOverrides } from '#/shared/db/schema/portal-look.schema'
import {
  portals,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import { isGuestLocale } from '#/shared/domain/guest-locale'
import { portalId as toPortalId, unbrand } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import {
  lookSourcesOf,
  nextPortalLook,
  portalHeroAltTextsOf,
  portalLookColumnsOf,
  portalLookOverrideOf,
  portalLookSourceVersion,
  type NextPortalLook,
  type PortalLookBase,
  type PortalLookOverride,
} from '../../domain/portal-look'
import { portalPageEditKey } from '../../domain/portal-page-edit'
import type {
  PortalLookRepository,
  SavePortalLookPartInput,
  SavePortalLookPartResult,
} from '../../application/ports/portal-look.repository'
import { recordPortalContentChange } from '../portal-page-edits'
import {
  lockPortalPublicationProperty,
  lockPortalPublicationWorkingCopy,
} from '../portal-publication-serialization'

type PortalScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
}>

const scopeOf = (input: SavePortalLookPartInput): PortalScope => ({
  organizationId: unbrand(input.organizationId),
  propertyId: unbrand(input.propertyId),
  portalId: unbrand(input.portalId),
})

/** The Portal's languages, read under its row lock: a description is kept only in these. */
async function portalLanguages(tx: Tx, scope: PortalScope): Promise<readonly string[]> {
  const [row] = await tx
    .select({
      primary: portals.primaryGuestLocale,
      additional: portals.additionalGuestLocales,
    })
    .from(portals)
    .where(
      and(
        eq(portals.organizationId, scope.organizationId),
        eq(portals.propertyId, scope.propertyId),
        eq(portals.id, scope.portalId),
      ),
    )
    .limit(1)
  if (!row) return []
  const additional = Array.isArray(row.additional) ? row.additional : []
  return [row.primary, ...additional].filter(isGuestLocale)
}

/**
 * What the Portal sees of the Property look: the Brand Profile, and its photo's
 * description in each of the Portal's languages. Null without a profile.
 */
async function lookBaseOf(tx: Tx, scope: PortalScope): Promise<PortalLookBase | null> {
  const [profile] = await tx
    .select({
      primaryColor: propertyPortalBrandProfiles.primaryColor,
      backgroundColor: propertyPortalBrandProfiles.backgroundColor,
      backgroundMode: propertyPortalBrandProfiles.backgroundMode,
      wordmark: propertyPortalBrandProfiles.wordmark,
      logoAssetId: propertyPortalBrandProfiles.logoAssetId,
      heroAssetId: propertyPortalBrandProfiles.heroAssetId,
      heroFocalX: propertyPortalBrandProfiles.heroFocalX,
      heroFocalY: propertyPortalBrandProfiles.heroFocalY,
      lookVersion: propertyPortalBrandProfiles.lookVersion,
    })
    .from(propertyPortalBrandProfiles)
    .where(
      and(
        eq(propertyPortalBrandProfiles.organizationId, scope.organizationId),
        eq(propertyPortalBrandProfiles.propertyId, scope.propertyId),
      ),
    )
    .limit(1)
  if (!profile) return null
  const languages = await portalLanguages(tx, scope)
  const contents =
    languages.length === 0
      ? []
      : await tx
          .select({
            locale: propertyPortalBrandContents.locale,
            heroAltText: propertyPortalBrandContents.heroAltText,
          })
          .from(propertyPortalBrandContents)
          .where(
            and(
              eq(propertyPortalBrandContents.organizationId, scope.organizationId),
              eq(propertyPortalBrandContents.propertyId, scope.propertyId),
              inArray(propertyPortalBrandContents.locale, [...languages]),
            ),
          )
  return {
    profile,
    heroAltTexts: portalHeroAltTextsOf(
      Object.fromEntries(contents.map((row) => [row.locale, row.heroAltText])),
    ),
  }
}

async function currentOverride(
  tx: Tx,
  scope: PortalScope,
): Promise<PortalLookOverride | null> {
  const [row] = await tx
    .select()
    .from(portalLookOverrides)
    .where(
      and(
        eq(portalLookOverrides.organizationId, scope.organizationId),
        eq(portalLookOverrides.propertyId, scope.propertyId),
        eq(portalLookOverrides.portalId, scope.portalId),
      ),
    )
    .limit(1)
  return row === undefined ? null : portalLookOverrideOf(row)
}

const followsEverything = (override: PortalLookOverride): boolean =>
  override.photo.mode === 'inherit' &&
  override.colours.mode === 'inherit' &&
  override.identity.mode === 'inherit'

/** The row as `next` holds it; a group that follows the Property is stored with no values. */
async function writeOverride(
  tx: Tx,
  scope: PortalScope,
  next: NextPortalLook,
  input: SavePortalLookPartInput,
): Promise<void> {
  const columns = portalLookColumnsOf(next.override)
  const writer = { updatedBy: unbrand(input.actorUserId), updatedAt: input.at }
  await tx
    .insert(portalLookOverrides)
    .values({ ...scope, ...columns, ...writer, createdAt: input.at })
    .onConflictDoUpdate({
      target: [portalLookOverrides.organizationId, portalLookOverrides.portalId],
      set: { ...columns, ...writer },
    })
}

/** Each facet guests would see differently: a ledger row and a fence of this Portal alone. */
async function recordLookEdits(
  tx: Tx,
  scope: PortalScope,
  next: NextPortalLook,
  input: SavePortalLookPartInput,
): Promise<void> {
  for (const facet of next.changedFacets) {
    const key = portalPageEditKey.portalLook(facet)
    await recordPortalContentChange(tx, {
      ...scope,
      kind: 'portal_configuration',
      key,
      ledger: [{ key }],
      sourceVersion: portalLookSourceVersion(next.override.lookVersion),
      changedAt: input.at,
      actorUserId: unbrand(input.actorUserId),
    })
  }
}

/** One save, inside its transaction: Property lock, Portal row, Brand Profile, current row, then the write. */
async function savePart(
  tx: Tx,
  input: SavePortalLookPartInput,
): Promise<SavePortalLookPartResult> {
  const scope = scopeOf(input)
  await lockPortalPublicationProperty(tx, scope.organizationId, scope.propertyId)
  const isPortal = await lockPortalPublicationWorkingCopy(
    tx,
    scope.organizationId,
    scope.propertyId,
    scope.portalId,
  )
  if (!isPortal) return { status: 'portal_not_found' }
  const base = await lookBaseOf(tx, scope)
  if (!base) return { status: 'brand_profile_missing' }
  const current = await currentOverride(tx, scope)
  const next = nextPortalLook(current, base, input.change)
  // A Portal with no row that is told to follow what it already follows needs no row.
  if (current !== null || !followsEverything(next.override)) {
    await writeOverride(tx, scope, next, input)
  }
  await recordLookEdits(tx, scope, next, input)
  return { status: 'saved', ...next }
}

export const createPortalLookRepository = (db: Database): PortalLookRepository => ({
  findForPortal: (organizationIdValue, propertyIdValue, portalIdValue) =>
    trace('portalLook.findForPortal', async () => {
      const [row] = await db
        .select()
        .from(portalLookOverrides)
        .where(
          and(
            eq(portalLookOverrides.organizationId, unbrand(organizationIdValue)),
            eq(portalLookOverrides.propertyId, unbrand(propertyIdValue)),
            eq(portalLookOverrides.portalId, unbrand(portalIdValue)),
          ),
        )
        .limit(1)
      return row === undefined ? null : portalLookOverrideOf(row)
    }),

  listSourcesForPortals: (organizationIdValue, portalIdValues) =>
    trace('portalLook.listSourcesForPortals', async () => {
      if (portalIdValues.length === 0) return []
      const rows = await db
        .select()
        .from(portalLookOverrides)
        .where(
          and(
            eq(portalLookOverrides.organizationId, unbrand(organizationIdValue)),
            inArray(
              portalLookOverrides.portalId,
              portalIdValues.map((id) => unbrand(id)),
            ),
          ),
        )
      return rows.map((row) => ({
        portalId: toPortalId(row.portalId),
        sources: lookSourcesOf(portalLookOverrideOf(row)),
      }))
    }),

  countLivePortals: (organizationIdValue, propertyIdValue) =>
    trace('portalLook.countLivePortals', async () => {
      const [row] = await db
        .select({ total: count() })
        .from(portals)
        .where(
          and(
            eq(portals.organizationId, unbrand(organizationIdValue)),
            eq(portals.propertyId, unbrand(propertyIdValue)),
            isNull(portals.deletedAt),
            ne(portals.publicationState, 'archived'),
          ),
        )
      return row?.total ?? 0
    }),

  savePortalLookPart: (input) =>
    trace('portalLook.savePortalLookPart', () =>
      db.transaction((tx) => savePart(tx, input)),
    ),
})
