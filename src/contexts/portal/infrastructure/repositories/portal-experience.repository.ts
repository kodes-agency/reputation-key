import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalLocalizedOverrides,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import {
  unbrand,
  type OrganizationId,
  type PortalId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import type { PortalExperienceRepository } from '../../application/ports/portal-experience.repository'
import type {
  PortalBrandProfileSnapshot,
  PortalGuestLocale,
} from '../../domain/portal-publication-snapshot'
import { trace } from '#/shared/observability/trace'
import {
  contentFromRow,
  overrideFromRow,
  profileFromRow,
} from '../mappers/portal-experience.mapper'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import {
  lockPortalPublicationProperty,
  lockPortalPublicationWorkingCopy,
} from '../portal-publication-serialization'
import { recordPortalContentChange } from '../portal-page-edits'
import {
  portalLocalizedOverrideUpdated,
  portalPropertyBrandContentUpdated,
  portalPropertyBrandProfileUpdated,
} from '../../domain/events'
import {
  AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
  DEFAULT_PROPERTY_BRAND_PALETTE,
} from '../../domain/portal-experience'
import {
  changedLookFacets,
  lookPendingKey,
  type BackgroundMode,
  type LookFacet,
  type PropertyLook,
} from '../../domain/property-look'

type PropertyScope = Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>
type BrandProfileFields = Omit<PortalBrandProfileSnapshot, 'version'> &
  Readonly<{
    /** Left out, a first profile has none and an existing one keeps its own. */
    wordmark?: string | null
    /** Left out, a first profile is automatic and an existing one keeps its own. */
    backgroundMode?: BackgroundMode
  }>

/** Brand writes take the Property's publication lock before touching a row. */
function lockPropertyPublication(tx: Tx, scope: PropertyScope): Promise<void> {
  return lockPortalPublicationProperty(
    tx,
    unbrand(scope.organizationId),
    unbrand(scope.propertyId),
  )
}

/** The one Brand Profile row of a Property, in its organisation. */
function propertyProfileScope(scope: PropertyScope) {
  return and(
    eq(propertyPortalBrandProfiles.organizationId, unbrand(scope.organizationId)),
    eq(propertyPortalBrandProfiles.propertyId, unbrand(scope.propertyId)),
  )
}

/** A Property's first Brand Profile row: version 1, created and updated at once. */
function firstProfileRow(
  input: PropertyScope & Readonly<{ id: string; at: Date }>,
  fields: BrandProfileFields,
  updatedBy: string,
) {
  return {
    id: input.id,
    organizationId: unbrand(input.organizationId),
    propertyId: unbrand(input.propertyId),
    ...fields,
    version: 1,
    updatedBy,
    createdAt: input.at,
    updatedAt: input.at,
  }
}

/** A profile that has only its public display name: no images, default colours. */
function displayNameOnlyProfile(displayName: string): BrandProfileFields {
  return {
    displayName,
    logoUrl: null,
    defaultHeroImageUrl: null,
    ...DEFAULT_PROPERTY_BRAND_PALETTE,
  }
}

/** What a Brand Profile write moved, and so what it has to fence and announce. */
type ProfileChange = Readonly<{
  /** The public display name changed, or the profile was just created. */
  nameChanged: boolean
  /** The display name before and after, kept in the page-edit ledger when it changed. */
  previousName: string | null
  displayName: string
  /** The facets of the look that changed. */
  facets: readonly LookFacet[]
  version: number
  lookVersion: number
  /** Who made the change; null when the system did (the automatic name). */
  actorUserId: string | null
}>

/**
 * Every Brand Profile write that moved something fences Portal publication:
 * a name change with one row under `all` (sourced at `version`), each look
 * facet with its own `look:<facet>` row (sourced at `lookVersion`). The fact
 * announces the profile version, which look edits leave where it was.
 */
async function recordPropertyProfileChange(
  tx: Tx,
  input: PropertyScope & Readonly<{ at: Date }>,
  change: ProfileChange,
): Promise<void> {
  const fence = {
    organizationId: unbrand(input.organizationId),
    propertyId: unbrand(input.propertyId),
    kind: 'property_brand_profile' as const,
    changedAt: input.at,
    actorUserId: change.actorUserId,
  }
  if (change.nameChanged) {
    await recordPortalContentChange(tx, {
      ...fence,
      ledger: [
        { key: 'all', previousText: change.previousName, newText: change.displayName },
      ],
      sourceVersion: `v${change.version}`,
    })
  }
  for (const facet of change.facets) {
    await recordPortalContentChange(tx, {
      ...fence,
      key: lookPendingKey(facet),
      ledger: [{ key: lookPendingKey(facet) }],
      sourceVersion: `v${change.lookVersion}`,
    })
  }
  if (!change.nameChanged && change.facets.length === 0) return
  const event = portalPropertyBrandProfileUpdated({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    profileVersion: change.version,
    sourceAggregateVersion: input.at.toISOString(),
    occurredAt: input.at,
  })
  await insertOutboxRow(tx, event, { recordedAt: input.at })
}

/** The look-bearing fields of a stored profile, for comparing with a save. */
function lookOfRow(row: typeof propertyPortalBrandProfiles.$inferSelect): PropertyLook {
  const profile = profileFromRow(row)
  return {
    primaryColor: profile.primaryColor,
    backgroundColor: profile.backgroundColor,
    textColor: profile.textColor,
    backgroundMode: profile.backgroundMode,
    wordmark: profile.wordmark,
    logoUrl: profile.logoUrl,
    defaultHeroImageUrl: profile.defaultHeroImageUrl,
    logoAssetId: profile.logoAssetId,
    heroAssetId: profile.heroAssetId,
    heroFocalX: profile.heroFocalX,
    heroFocalY: profile.heroFocalY,
  }
}

type ProfileRow = typeof propertyPortalBrandProfiles.$inferSelect

async function currentProfileRow(tx: Tx, scope: PropertyScope) {
  const [current] = await tx
    .select()
    .from(propertyPortalBrandProfiles)
    .where(propertyProfileScope(scope))
    .limit(1)
  return current
}

/**
 * Run a Brand Profile write inside the Property's publication lock, with the
 * profile as it is under that lock. Null when the Property has no profile.
 */
function withLockedProfile<T>(
  db: Database,
  scope: PropertyScope,
  run: (tx: Tx, current: ProfileRow) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    await lockPropertyPublication(tx, scope)
    const current = await currentProfileRow(tx, scope)
    return current ? run(tx, current) : null
  })
}

type LookColumns = Partial<
  Pick<
    ProfileRow,
    | 'primaryColor'
    | 'backgroundMode'
    | 'backgroundColor'
    | 'wordmark'
    | 'logoAssetId'
    | 'heroAssetId'
    | 'heroFocalX'
    | 'heroFocalY'
  >
>

/**
 * Write look columns and nothing else: the display name, the text colour and
 * `updated_by` stay with the writers that own them. The caller has found which
 * facets of the look the write moves; one that moves none writes nothing, and
 * one that does moves the look version, fences the live Portals under
 * `look:<facet>` and announces the profile.
 */
async function writeLookColumns(
  tx: Tx,
  input: PropertyScope & Readonly<{ actorUserId: UserId; at: Date }>,
  current: ProfileRow,
  columns: LookColumns,
  facets: readonly LookFacet[],
): Promise<ProfileRow> {
  if (facets.length === 0) return current
  const [row] = await tx
    .update(propertyPortalBrandProfiles)
    .set({
      ...columns,
      lookVersion: sql`${propertyPortalBrandProfiles.lookVersion} + 1`,
      updatedAt: input.at,
    })
    .where(propertyProfileScope(input))
    .returning()
  if (!row) throw new Error('Property Brand Profile was not saved')
  await recordPropertyProfileChange(tx, input, {
    nameChanged: false,
    previousName: current.displayName,
    displayName: row.displayName,
    facets,
    version: row.version,
    lookVersion: row.lookVersion,
    actorUserId: unbrand(input.actorUserId),
  })
  return row
}

type MediaColumns = Pick<
  Partial<ProfileRow>,
  'logoAssetId' | 'heroAssetId' | 'heroFocalX' | 'heroFocalY'
>

/** The image columns of the look: the facets they move are found by comparing the look before and after. */
function writeProfileMedia(
  tx: Tx,
  input: PropertyScope & Readonly<{ actorUserId: UserId; at: Date }>,
  current: ProfileRow,
  media: MediaColumns,
): Promise<ProfileRow> {
  const before = lookOfRow(current)
  return writeLookColumns(
    tx,
    input,
    current,
    media,
    changedLookFacets(before, { ...before, ...media }),
  )
}

/**
 * Keep one language's description of the photograph. A language with wording
 * keeps its title and text; one without gets a row holding the description
 * alone (its title and text read as unwritten, so nothing is claimed as
 * wording). Unchanged, or clearing what is not there, writes nothing.
 */
async function saveHeroAltText(
  tx: Tx,
  input: PropertyScope & Readonly<{ id: string; actorUserId: UserId; at: Date }>,
  altText: Readonly<{ locale: PortalGuestLocale; text: string | null }>,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(propertyPortalBrandContents)
    .where(
      and(
        eq(propertyPortalBrandContents.organizationId, unbrand(input.organizationId)),
        eq(propertyPortalBrandContents.propertyId, unbrand(input.propertyId)),
        eq(propertyPortalBrandContents.locale, altText.locale),
      ),
    )
    .limit(1)
  if ((current?.heroAltText ?? null) === altText.text) return
  const [row] = current
    ? await tx
        .update(propertyPortalBrandContents)
        .set({
          heroAltText: altText.text,
          version: sql`${propertyPortalBrandContents.version} + 1`,
          updatedBy: unbrand(input.actorUserId),
          updatedAt: input.at,
        })
        .where(eq(propertyPortalBrandContents.id, current.id))
        .returning()
    : await tx
        .insert(propertyPortalBrandContents)
        .values({
          id: input.id,
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          locale: altText.locale,
          title: '',
          shortDescription: '',
          heroAltText: altText.text,
          version: 1,
          updatedBy: unbrand(input.actorUserId),
          createdAt: input.at,
          updatedAt: input.at,
        })
        .returning()
  if (!row) throw new Error('Property photograph description was not saved')
  await recordPortalContentChange(tx, {
    organizationId: unbrand(input.organizationId),
    propertyId: unbrand(input.propertyId),
    kind: 'property_brand_content',
    key: altText.locale,
    // No wording moved: the ledger says which language changed, not what it said.
    ledger: [{ key: altText.locale }],
    sourceVersion: `v${row.version}`,
    changedAt: input.at,
    actorUserId: unbrand(input.actorUserId),
  })
  await insertOutboxRow(
    tx,
    portalPropertyBrandContentUpdated({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      guestLocale: altText.locale,
      contentVersion: row.version,
      sourceAggregateVersion: input.at.toISOString(),
      occurredAt: input.at,
    }),
    { recordedAt: input.at },
  )
}

type OverrideChange = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  locale: PortalGuestLocale
  updatedBy: UserId
  at: Date
}>

/** The override title before and after a write; the ledger keeps them when they differ. */
type OverrideTitles = Readonly<{ previousTitle: string | null; newTitle: string | null }>

/** Every override write fences Portal publication and announces the version (null: cleared). */
async function recordOverrideChange(
  tx: Tx,
  input: OverrideChange,
  version: number | null,
  { previousTitle, newTitle }: OverrideTitles,
): Promise<void> {
  await recordPortalContentChange(tx, {
    organizationId: unbrand(input.organizationId),
    propertyId: unbrand(input.propertyId),
    portalId: unbrand(input.portalId),
    kind: 'portal_localized_override',
    key: input.locale,
    ledger: [
      {
        key: input.locale,
        ...(previousTitle === newTitle
          ? {}
          : { previousText: previousTitle, newText: newTitle }),
      },
    ],
    sourceVersion: version === null ? `cleared:${input.at.toISOString()}` : `v${version}`,
    changedAt: input.at,
    actorUserId: unbrand(input.updatedBy),
  })
  const event = portalLocalizedOverrideUpdated({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    guestLocale: input.locale,
    overrideVersion: version,
    sourceAggregateVersion: input.at.toISOString(),
    occurredAt: input.at,
  })
  await insertOutboxRow(tx, event, { recordedAt: input.at })
}

export const createPortalExperienceRepository = (
  db: Database,
): PortalExperienceRepository => ({
  getPropertyExperience: (orgId, propertyIdValue) =>
    trace('portalExperience.getProperty', async () => {
      const [profiles, content] = await Promise.all([
        db
          .select()
          .from(propertyPortalBrandProfiles)
          .where(
            and(
              eq(propertyPortalBrandProfiles.organizationId, unbrand(orgId)),
              eq(propertyPortalBrandProfiles.propertyId, unbrand(propertyIdValue)),
            ),
          )
          .limit(1),
        db
          .select()
          .from(propertyPortalBrandContents)
          .where(
            and(
              eq(propertyPortalBrandContents.organizationId, unbrand(orgId)),
              eq(propertyPortalBrandContents.propertyId, unbrand(propertyIdValue)),
            ),
          )
          .orderBy(asc(propertyPortalBrandContents.locale)),
      ])
      return {
        profile: profiles[0] ? profileFromRow(profiles[0]) : null,
        content: content.map(contentFromRow),
      }
    }),

  listPortalOverrides: (orgId, propertyIdValue, portalIdValue) =>
    trace('portalExperience.listPortalOverrides', async () => {
      const rows = await db
        .select()
        .from(portalLocalizedOverrides)
        .where(
          and(
            eq(portalLocalizedOverrides.organizationId, unbrand(orgId)),
            eq(portalLocalizedOverrides.propertyId, unbrand(propertyIdValue)),
            eq(portalLocalizedOverrides.portalId, unbrand(portalIdValue)),
          ),
        )
        .orderBy(asc(portalLocalizedOverrides.locale))
      return rows.map(overrideFromRow)
    }),

  savePropertyProfile: (input) =>
    trace('portalExperience.savePropertyProfile', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPropertyPublication(tx, input)
        const scope = propertyProfileScope(input)
        const [current] = await tx
          .select()
          .from(propertyPortalBrandProfiles)
          .where(scope)
          .limit(1)
        if (!current) {
          const [created] = await tx
            .insert(propertyPortalBrandProfiles)
            .values(firstProfileRow(input, input.profile, unbrand(input.updatedBy)))
            .returning()
          if (!created) throw new Error('Property Brand Profile was not saved')
          await recordPropertyProfileChange(tx, input, {
            nameChanged: true,
            previousName: null,
            displayName: created.displayName,
            facets: [],
            version: created.version,
            lookVersion: created.lookVersion,
            actorUserId: unbrand(input.updatedBy),
          })
          return profileFromRow(created)
        }
        const { wordmark, backgroundMode, ...fields } = input.profile
        const next = {
          ...fields,
          wordmark: wordmark === undefined ? current.wordmark : wordmark,
          backgroundMode: backgroundMode ?? profileFromRow(current).backgroundMode,
        }
        // The images this write has no field for stay as they are, so they are
        // compared as they were.
        const before = lookOfRow(current)
        const facets = changedLookFacets(before, { ...before, ...next })
        const nameChanged = current.displayName !== next.displayName
        // A save that moves nothing still records who confirmed the profile.
        const [row] = await tx
          .update(propertyPortalBrandProfiles)
          .set({
            ...next,
            version: nameChanged
              ? sql`${propertyPortalBrandProfiles.version} + 1`
              : current.version,
            lookVersion:
              facets.length > 0
                ? sql`${propertyPortalBrandProfiles.lookVersion} + 1`
                : current.lookVersion,
            updatedBy: unbrand(input.updatedBy),
            updatedAt: input.at,
          })
          .where(scope)
          .returning()
        if (!row) throw new Error('Property Brand Profile was not saved')
        await recordPropertyProfileChange(tx, input, {
          nameChanged,
          previousName: current.displayName,
          displayName: row.displayName,
          facets,
          version: row.version,
          lookVersion: row.lookVersion,
          actorUserId: unbrand(input.updatedBy),
        })
        return profileFromRow(row)
      })

      return committed
    }),

  savePropertyLook: (input) =>
    trace('portalExperience.savePropertyLook', () =>
      withLockedProfile(db, input, async (tx, current) => {
        const { look } = input
        const before = lookOfRow(current)
        const after: PropertyLook = {
          ...before,
          primaryColor: look.primaryColor,
          backgroundMode: look.backgroundMode,
          backgroundColor: look.backgroundColor ?? before.backgroundColor,
          wordmark: look.wordmark === undefined ? before.wordmark : look.wordmark,
        }
        const row = await writeLookColumns(
          tx,
          input,
          current,
          {
            primaryColor: after.primaryColor,
            backgroundMode: after.backgroundMode,
            backgroundColor: after.backgroundColor,
            wordmark: after.wordmark,
          },
          changedLookFacets(before, after),
        )
        return profileFromRow(row)
      }),
    ),

  savePropertyHero: (input) =>
    trace('portalExperience.savePropertyHero', () =>
      withLockedProfile(db, input, async (tx, current) => {
        const { hero } = input
        const row = await writeProfileMedia(tx, input, current, {
          heroAssetId: hero?.assetId ?? null,
          heroFocalX: hero?.focalX ?? null,
          heroFocalY: hero?.focalY ?? null,
        })
        for (const altText of input.altTexts ?? []) {
          await saveHeroAltText(tx, input, altText)
        }
        return profileFromRow(row)
      }),
    ),

  savePropertyLogo: (input) =>
    trace('portalExperience.savePropertyLogo', () =>
      withLockedProfile(db, input, async (tx, current) =>
        profileFromRow(
          await writeProfileMedia(tx, input, current, {
            logoAssetId: input.logoAssetId,
          }),
        ),
      ),
    ),

  saveDefaultGuestLocales: (input) =>
    trace('portalExperience.saveDefaultGuestLocales', async () => {
      // Only the one column moves: no version, no fence, no fact, and not the
      // person who last saved the profile (that decides whether the public
      // display name counts as confirmed).
      const [row] = await db
        .update(propertyPortalBrandProfiles)
        .set({ defaultGuestLocales: [...input.locales] })
        .where(propertyProfileScope(input))
        .returning()
      return row ? profileFromRow(row) : null
    }),

  ensurePropertyDisplayName: (input) =>
    trace('portalExperience.ensurePropertyDisplayName', () =>
      db.transaction(async (tx) => {
        await lockPropertyPublication(tx, input)
        const [row] = await tx
          .insert(propertyPortalBrandProfiles)
          .values(
            firstProfileRow(
              input,
              displayNameOnlyProfile(input.displayName),
              AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
            ),
          )
          .onConflictDoNothing({
            target: [
              propertyPortalBrandProfiles.organizationId,
              propertyPortalBrandProfiles.propertyId,
            ],
          })
          .returning()
        if (!row) return false
        await recordPropertyProfileChange(tx, input, {
          nameChanged: true,
          previousName: null,
          displayName: row.displayName,
          facets: [],
          version: row.version,
          lookVersion: row.lookVersion,
          actorUserId: null,
        })
        return true
      }),
    ),

  savePropertyDisplayName: (input) =>
    trace('portalExperience.savePropertyDisplayName', () =>
      db.transaction(async (tx) => {
        await lockPropertyPublication(tx, input)
        const scope = and(
          eq(propertyPortalBrandProfiles.organizationId, unbrand(input.organizationId)),
          eq(propertyPortalBrandProfiles.propertyId, unbrand(input.propertyId)),
        )
        const [current] = await tx
          .select()
          .from(propertyPortalBrandProfiles)
          .where(scope)
          .limit(1)
        if (current?.displayName === input.displayName) {
          // A person confirmed the name as it was: record who, but keep the
          // version, so reply drafts made with this name stay current.
          const [confirmed] = await tx
            .update(propertyPortalBrandProfiles)
            .set({ updatedBy: unbrand(input.updatedBy), updatedAt: input.at })
            .where(scope)
            .returning()
          if (!confirmed) throw new Error('Property Brand Profile was not saved')
          return profileFromRow(confirmed)
        }
        const [row] = current
          ? await tx
              .update(propertyPortalBrandProfiles)
              .set({
                displayName: input.displayName,
                version: sql`${propertyPortalBrandProfiles.version} + 1`,
                updatedBy: unbrand(input.updatedBy),
                updatedAt: input.at,
              })
              .where(scope)
              .returning()
          : await tx
              .insert(propertyPortalBrandProfiles)
              .values(
                firstProfileRow(
                  input,
                  displayNameOnlyProfile(input.displayName),
                  unbrand(input.updatedBy),
                ),
              )
              .returning()
        if (!row) throw new Error('Property Brand Profile was not saved')
        await recordPropertyProfileChange(tx, input, {
          nameChanged: true,
          previousName: current?.displayName ?? null,
          displayName: row.displayName,
          facets: [],
          version: row.version,
          lookVersion: row.lookVersion,
          actorUserId: unbrand(input.updatedBy),
        })
        return profileFromRow(row)
      }),
    ),

  savePropertyContent: (input) =>
    trace('portalExperience.savePropertyContent', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPropertyPublication(tx, input)
        const [current] = await tx
          .select({ title: propertyPortalBrandContents.title })
          .from(propertyPortalBrandContents)
          .where(
            and(
              eq(
                propertyPortalBrandContents.organizationId,
                unbrand(input.organizationId),
              ),
              eq(propertyPortalBrandContents.propertyId, unbrand(input.propertyId)),
              eq(propertyPortalBrandContents.locale, input.locale),
            ),
          )
          .limit(1)
        const [row] = await tx
          .insert(propertyPortalBrandContents)
          .values({
            id: input.id,
            organizationId: unbrand(input.organizationId),
            propertyId: unbrand(input.propertyId),
            locale: input.locale,
            ...input.content,
            version: 1,
            updatedBy: unbrand(input.updatedBy),
            createdAt: input.at,
            updatedAt: input.at,
          })
          .onConflictDoUpdate({
            target: [
              propertyPortalBrandContents.organizationId,
              propertyPortalBrandContents.propertyId,
              propertyPortalBrandContents.locale,
            ],
            // An omitted alt text is left alone: `undefined` drops out of the
            // update set, while `null` clears it.
            set: {
              ...input.content,
              version: sql`${propertyPortalBrandContents.version} + 1`,
              updatedBy: unbrand(input.updatedBy),
              updatedAt: input.at,
            },
          })
          .returning()
        if (!row) throw new Error('Property guest content was not saved')
        await recordPortalContentChange(tx, {
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          kind: 'property_brand_content',
          key: input.locale,
          ledger: [
            {
              key: input.locale,
              ...(current?.title === row.title
                ? {}
                : { previousText: current?.title ?? null, newText: row.title }),
            },
          ],
          sourceVersion: `v${row.version}`,
          changedAt: input.at,
          actorUserId: unbrand(input.updatedBy),
        })
        const event = portalPropertyBrandContentUpdated({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          guestLocale: input.locale,
          contentVersion: row.version,
          sourceAggregateVersion: input.at.toISOString(),
          occurredAt: input.at,
        })
        await insertOutboxRow(tx, event, { recordedAt: input.at })
        return contentFromRow(row)
      })

      return committed
    }),

  savePortalOverride: (input) =>
    trace('portalExperience.savePortalOverride', async () => {
      const committed = await db.transaction(async (tx) => {
        const exists = await lockPortalPublicationWorkingCopy(
          tx,
          unbrand(input.organizationId),
          unbrand(input.propertyId),
          unbrand(input.portalId),
        )
        if (!exists) throw new Error('Portal localized override scope is unavailable')
        const [current] = await tx
          .select({ title: portalLocalizedOverrides.title })
          .from(portalLocalizedOverrides)
          .where(
            and(
              eq(portalLocalizedOverrides.organizationId, unbrand(input.organizationId)),
              eq(portalLocalizedOverrides.propertyId, unbrand(input.propertyId)),
              eq(portalLocalizedOverrides.portalId, unbrand(input.portalId)),
              eq(portalLocalizedOverrides.locale, input.locale),
            ),
          )
          .limit(1)
        const previousTitle = current?.title ?? null
        const hasValue = Object.values(input.override).some((value) => value !== null)
        if (!hasValue) {
          const scope = and(
            eq(portalLocalizedOverrides.organizationId, unbrand(input.organizationId)),
            eq(portalLocalizedOverrides.propertyId, unbrand(input.propertyId)),
            eq(portalLocalizedOverrides.portalId, unbrand(input.portalId)),
            eq(portalLocalizedOverrides.locale, input.locale),
          )
          // A row that still carries the Linktree title is not empty: clear the
          // fields this writer owns and keep the row for the title's sake.
          const [kept] = await tx
            .update(portalLocalizedOverrides)
            .set({
              title: null,
              shortDescription: null,
              heroImageUrl: null,
              version: sql`${portalLocalizedOverrides.version} + 1`,
              updatedBy: unbrand(input.updatedBy),
              updatedAt: input.at,
            })
            .where(and(scope, isNotNull(portalLocalizedOverrides.linktreeTitle)))
            .returning()
          if (kept) {
            await recordOverrideChange(tx, input, kept.version, {
              previousTitle,
              newTitle: null,
            })
            return overrideFromRow(kept)
          }
          const deleted = await tx
            .delete(portalLocalizedOverrides)
            .where(scope)
            .returning({ id: portalLocalizedOverrides.id })
          if (deleted.length > 0) {
            await recordOverrideChange(tx, input, null, { previousTitle, newTitle: null })
          }
          return null
        }
        const [row] = await tx
          .insert(portalLocalizedOverrides)
          .values({
            id: input.id,
            organizationId: unbrand(input.organizationId),
            propertyId: unbrand(input.propertyId),
            portalId: unbrand(input.portalId),
            locale: input.locale,
            ...input.override,
            version: 1,
            updatedBy: unbrand(input.updatedBy),
            createdAt: input.at,
            updatedAt: input.at,
          })
          .onConflictDoUpdate({
            target: [
              portalLocalizedOverrides.organizationId,
              portalLocalizedOverrides.portalId,
              portalLocalizedOverrides.locale,
            ],
            set: {
              ...input.override,
              version: sql`${portalLocalizedOverrides.version} + 1`,
              updatedBy: unbrand(input.updatedBy),
              updatedAt: input.at,
            },
          })
          .returning()
        if (!row) throw new Error('Portal localized override was not saved')
        await recordOverrideChange(tx, input, row.version, {
          previousTitle,
          newTitle: row.title,
        })
        return overrideFromRow(row)
      })

      return committed
    }),
})
