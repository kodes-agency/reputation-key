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
import { recordPortalPendingContentChange } from '../portal-pending-content-changes'
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
  /** The facets of the look that changed. */
  facets: readonly LookFacet[]
  version: number
  lookVersion: number
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
  }
  if (change.nameChanged) {
    await recordPortalPendingContentChange(tx, {
      ...fence,
      sourceVersion: `v${change.version}`,
    })
  }
  for (const facet of change.facets) {
    await recordPortalPendingContentChange(tx, {
      ...fence,
      key: lookPendingKey(facet),
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
  }
}

type OverrideChange = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  locale: PortalGuestLocale
  at: Date
}>

/** Every override write fences Portal publication and announces the version (null: cleared). */
async function recordOverrideChange(
  tx: Tx,
  input: OverrideChange,
  version: number | null,
): Promise<void> {
  await recordPortalPendingContentChange(tx, {
    organizationId: unbrand(input.organizationId),
    propertyId: unbrand(input.propertyId),
    portalId: unbrand(input.portalId),
    kind: 'portal_localized_override',
    key: input.locale,
    sourceVersion: version === null ? `cleared:${input.at.toISOString()}` : `v${version}`,
    changedAt: input.at,
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
            facets: [],
            version: created.version,
            lookVersion: created.lookVersion,
          })
          return profileFromRow(created)
        }
        const { wordmark, backgroundMode, ...fields } = input.profile
        const next = {
          ...fields,
          wordmark: wordmark === undefined ? current.wordmark : wordmark,
          backgroundMode: backgroundMode ?? profileFromRow(current).backgroundMode,
        }
        const facets = changedLookFacets(lookOfRow(current), next)
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
          facets,
          version: row.version,
          lookVersion: row.lookVersion,
        })
        return profileFromRow(row)
      })

      return committed
    }),

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
          facets: [],
          version: row.version,
          lookVersion: row.lookVersion,
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
          facets: [],
          version: row.version,
          lookVersion: row.lookVersion,
        })
        return profileFromRow(row)
      }),
    ),

  savePropertyContent: (input) =>
    trace('portalExperience.savePropertyContent', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPropertyPublication(tx, input)
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
        await recordPortalPendingContentChange(tx, {
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          kind: 'property_brand_content',
          key: input.locale,
          sourceVersion: `v${row.version}`,
          changedAt: input.at,
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
            await recordOverrideChange(tx, input, kept.version)
            return overrideFromRow(kept)
          }
          const deleted = await tx
            .delete(portalLocalizedOverrides)
            .where(scope)
            .returning({ id: portalLocalizedOverrides.id })
          if (deleted.length > 0) await recordOverrideChange(tx, input, null)
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
        await recordOverrideChange(tx, input, row.version)
        return overrideFromRow(row)
      })

      return committed
    }),
})
