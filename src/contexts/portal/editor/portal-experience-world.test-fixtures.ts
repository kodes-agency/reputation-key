import { freshUuid } from '#/shared/testing/fresh-uuid'
import { beforeEach, expect } from 'vitest'
import { getDb } from '#/shared/db'
import {
  organizationId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { staffApiOf } from '#/shared/testing/staff-public-api-stub'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { savePropertyPortalBrandProfile } from './manage-portal-experience.server'
import { isPortalError } from '../domain/errors'
import { createPortalLookRepository } from '../look/portal-look-repository.server'
import { createPortalExperienceRepository } from './portal-experience-repository.server'
import { createPortalMediaAssetRepository } from '../media/portal-media-asset-repository.server'
import { createPortalRepository } from '../publication/portal-repository.server'
import {
  MEDIA_EXPERIENCE_TABLES,
  seedMediaProperty,
} from '../infrastructure/testing/portal-media-experience-seed'

export const ORG_A = organizationId('org-portal-experience-cases-0001')
export const ORG_B = organizationId('org-portal-experience-cases-0002')
export const NOW = new Date('2026-08-27T12:00:00.000Z')

let poolOf: ReturnType<typeof setupIntegrationDb>['getPool'] | undefined

export const getPool = () => {
  if (!poolOf) throw new Error('setupExperienceDb() has not run in this file')
  return poolOf()
}

/** Registers the database and event-schema hooks; call once at the top of each experience test file. */
export function setupExperienceDb(): void {
  poolOf = setupIntegrationDb({
    orgA: ORG_A,
    orgB: ORG_B,
    tables: MEDIA_EXPERIENCE_TABLES,
  }).getPool
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
}

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

/** The promise is refused with a Portal error of `code`. */
export const rejectsWithPortalCode = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(failsWith(code))

export const depsOf = (accessible: ReadonlyArray<PropertyId> | null = null) => ({
  experienceRepo: createPortalExperienceRepository(getDb()),
  mediaRepo: createPortalMediaAssetRepository(getDb()),
  portalRepo: createPortalRepository(getDb()),
  portalLookRepo: createPortalLookRepository(getDb()),
  staffPublicApi: staffApiOf(accessible),
  idGen: () => freshUuid(),
  clock: () => NOW,
})

export const adminOf = (org: OrganizationId = ORG_A) =>
  buildTestAuthContext({ role: 'AccountAdmin', organizationId: org })
export const managerOf = (org: OrganizationId = ORG_A) =>
  buildTestAuthContext({ role: 'PropertyManager', organizationId: org })

/** Denies every permission: the dynamic resolver path, not a built-in role. */
export const withoutPermissions = (): AuthContext =>
  buildTestAuthContext({ organizationId: ORG_A, effectivePermissions: new Set() })

export const query = (text: string, values: readonly unknown[] = []) =>
  getPool().query(text, [...values])

export async function profileRow(property: PropertyId, org: OrganizationId = ORG_A) {
  const { rows } = await query(
    `SELECT display_name, logo_url, default_hero_image_url, primary_color, background_color,
            text_color, wordmark, background_mode, default_guest_locales, updated_by, version
     FROM property_portal_brand_profiles WHERE organization_id = $1 AND property_id = $2`,
    [org, property],
  )
  return rows[0]
}

export async function contentRow(property: PropertyId, locale: string) {
  const { rows } = await query(
    `SELECT title, short_description, hero_alt_text, updated_by
     FROM property_portal_brand_contents
     WHERE organization_id = $1 AND property_id = $2 AND locale = $3`,
    [ORG_A, property, locale],
  )
  return rows[0]
}

export async function overrideRowOf(portal: PortalId, locale = 'en') {
  const { rows } = await query(
    `SELECT title, short_description, hero_image_url, updated_by, organization_id
     FROM portal_localized_overrides WHERE portal_id = $1 AND locale = $2`,
    [portal, locale],
  )
  return rows[0]
}

export const eventTypes = async (org: OrganizationId = ORG_A) =>
  (
    await query(
      'SELECT event_type FROM outbox_events WHERE organization_id = $1 ORDER BY event_type',
      [org],
    )
  ).rows.map((row) => row.event_type as string)

export async function scene() {
  const property = await seedMediaProperty(getPool(), ORG_A)
  const otherProperty = await seedMediaProperty(getPool(), ORG_A)
  return { property, otherProperty }
}

export const brandProfileInput = (
  property: PropertyId,
  overrides: Readonly<Record<string, unknown>> = {},
): Parameters<ReturnType<typeof savePropertyPortalBrandProfile>>[0] =>
  // The DTO types the two image fields as `null`, so a well-typed caller cannot
  // supply a URL. The cast reproduces a caller that got past the DTO: the
  // suppression has to hold on its own, not by grace of the type.
  ({
    propertyId: property,
    displayName: '  Seaside Retreat  ',
    primaryColor: '#6366f1',
    backgroundColor: '#ffffff',
    textColor: '#111827',
    logoUrl: 'https://cdn.example.com/logo.png',
    defaultHeroImageUrl: 'https://cdn.example.com/hero.png',
    ...overrides,
  }) as unknown as Parameters<ReturnType<typeof savePropertyPortalBrandProfile>>[0]
