import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalLocalizedOverrides,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
} from '#/shared/db/schema/portal.schema'
import {
  organizationId,
  portalId,
  propertyId,
  unbrand,
  userId,
} from '#/shared/domain/ids'
import type {
  PortalExperienceRepository,
  PortalLocalizedOverride,
  PropertyPortalBrandContent,
  PropertyPortalBrandProfile,
} from '../../application/ports/portal-experience.repository'
import { trace } from '#/shared/observability/trace'
import { insertOutboxRow } from '#/shared/outbox/commit'
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

const profileFromRow = (
  row: typeof propertyPortalBrandProfiles.$inferSelect,
): PropertyPortalBrandProfile => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  displayName: row.displayName,
  logoUrl: row.logoUrl,
  defaultHeroImageUrl: row.defaultHeroImageUrl,
  primaryColor: row.primaryColor,
  backgroundColor: row.backgroundColor,
  textColor: row.textColor,
  version: row.version,
  updatedBy: userId(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const contentFromRow = (
  row: typeof propertyPortalBrandContents.$inferSelect,
): PropertyPortalBrandContent => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  locale: row.locale === 'bg' ? 'bg' : 'en',
  title: row.title,
  shortDescription: row.shortDescription,
  version: row.version,
  updatedBy: userId(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const overrideFromRow = (
  row: typeof portalLocalizedOverrides.$inferSelect,
): PortalLocalizedOverride => ({
  id: row.id,
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  portalId: portalId(row.portalId),
  locale: row.locale === 'bg' ? 'bg' : 'en',
  title: row.title,
  shortDescription: row.shortDescription,
  heroImageUrl: row.heroImageUrl,
  version: row.version,
  updatedBy: userId(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

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
        await lockPortalPublicationProperty(
          tx,
          unbrand(input.organizationId),
          unbrand(input.propertyId),
        )
        const [row] = await tx
          .insert(propertyPortalBrandProfiles)
          .values({
            id: input.id,
            organizationId: unbrand(input.organizationId),
            propertyId: unbrand(input.propertyId),
            ...input.profile,
            version: 1,
            updatedBy: unbrand(input.updatedBy),
            createdAt: input.at,
            updatedAt: input.at,
          })
          .onConflictDoUpdate({
            target: [
              propertyPortalBrandProfiles.organizationId,
              propertyPortalBrandProfiles.propertyId,
            ],
            set: {
              ...input.profile,
              version: sql`${propertyPortalBrandProfiles.version} + 1`,
              updatedBy: unbrand(input.updatedBy),
              updatedAt: input.at,
            },
          })
          .returning()
        if (!row) throw new Error('Property Brand Profile was not saved')
        await recordPortalPendingContentChange(tx, {
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          kind: 'property_brand_profile',
          sourceVersion: `v${row.version}`,
          changedAt: input.at,
        })
        const event = portalPropertyBrandProfileUpdated({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          profileVersion: row.version,
          sourceAggregateVersion: input.at.toISOString(),
          occurredAt: input.at,
        })
        await insertOutboxRow(tx, event, { recordedAt: input.at })
        return profileFromRow(row)
      })

      return committed
    }),

  savePropertyContent: (input) =>
    trace('portalExperience.savePropertyContent', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPortalPublicationProperty(
          tx,
          unbrand(input.organizationId),
          unbrand(input.propertyId),
        )
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
          const deleted = await tx
            .delete(portalLocalizedOverrides)
            .where(
              and(
                eq(
                  portalLocalizedOverrides.organizationId,
                  unbrand(input.organizationId),
                ),
                eq(portalLocalizedOverrides.propertyId, unbrand(input.propertyId)),
                eq(portalLocalizedOverrides.portalId, unbrand(input.portalId)),
                eq(portalLocalizedOverrides.locale, input.locale),
              ),
            )
            .returning({ id: portalLocalizedOverrides.id })
          if (deleted.length > 0) {
            await recordPortalPendingContentChange(tx, {
              organizationId: unbrand(input.organizationId),
              propertyId: unbrand(input.propertyId),
              portalId: unbrand(input.portalId),
              kind: 'portal_localized_override',
              key: input.locale,
              sourceVersion: `cleared:${input.at.toISOString()}`,
              changedAt: input.at,
            })
            const event = portalLocalizedOverrideUpdated({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              portalId: input.portalId,
              guestLocale: input.locale,
              overrideVersion: null,
              sourceAggregateVersion: input.at.toISOString(),
              occurredAt: input.at,
            })
            await insertOutboxRow(tx, event, { recordedAt: input.at })
            return null
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
        await recordPortalPendingContentChange(tx, {
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          portalId: unbrand(input.portalId),
          kind: 'portal_localized_override',
          key: input.locale,
          sourceVersion: `v${row.version}`,
          changedAt: input.at,
        })
        const event = portalLocalizedOverrideUpdated({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          portalId: input.portalId,
          guestLocale: input.locale,
          overrideVersion: row.version,
          sourceAggregateVersion: input.at.toISOString(),
          occurredAt: input.at,
        })
        await insertOutboxRow(tx, event, { recordedAt: input.at })
        return overrideFromRow(row)
      })

      return committed
    }),
})
