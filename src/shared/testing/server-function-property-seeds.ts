// Properties, their Google binding and review destination, Portals and
// Property access for the server-function harness.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import { seedGoogleConnection } from './google-connection-seed'
import type { HarnessSeedContext } from './server-function-seed-context'
import type { TestMember, TestOrganization } from './server-function-identity-seeds'

export type TestProperty = Readonly<{ id: string; organizationId: string }>

export type TestPortal = Readonly<{
  id: string
  organizationId: string
  propertyId: string
}>

export type PropertyLifecycle =
  'active' | 'suspended' | 'archived' | 'disconnecting' | 'purge_pending'

export type SeedPropertyOptions = Readonly<{
  name?: string
  timezone?: string
  /** A reply language tag such as 'en-Latn'. */
  defaultReplyLanguage?: string
  lifecycle?: PropertyLifecycle
  /**
   * Bind the Property to a Google location through an active google_connections
   * row. Its tokens are placeholders the app cannot open unless the file passes
   * `googleTokenEncryption`; then ENCRYPTION_KEY seals them as the app does.
   */
  google?: boolean | Readonly<{ accountId?: string; locationId?: string }>
  /** Give the Property a verified Google review destination. */
  reviewDestination?: boolean
}>

export type SeedPortalOptions = Readonly<{
  name?: string
  /** A personal Portal has a public name; 'place' is the default. */
  kind?: 'place' | 'personal'
  publicName?: string
  state?: 'draft' | 'published' | 'disabled' | 'archived'
  primaryLocale?: GuestLocale
  additionalLocales?: readonly GuestLocale[]
  skipPrivateRating?: boolean
  createdBy?: string
}>

export type PropertySeeds = Readonly<{
  seedProperty: (
    organization: TestOrganization,
    options?: SeedPropertyOptions,
  ) => Promise<TestProperty>
  /** A Portal row; a guest reaches it only once published (seedPublishedPortal). */
  seedPortal: (property: TestProperty, options?: SeedPortalOptions) => Promise<TestPortal>
  /** Give a PropertyManager the Property, as an accepted invitation does. */
  grantProperty: (member: TestMember, property: TestProperty) => Promise<void>
}>

/**
 * A second before the container's clock, at the millisecond precision the app
 * reads: commands fence on the updated_at they read and must move it forward.
 */
function seededAt(context: HarnessSeedContext): Date {
  return new Date(context.clock().getTime() - 1000)
}

async function bindGoogle(
  context: HarnessSeedContext,
  propertyId: string,
  organizationId: string,
  google: Exclude<SeedPropertyOptions['google'], boolean | undefined> | true,
): Promise<void> {
  const { connectionId } = await seedGoogleConnection(context.pool(), {
    organizationId,
    googleSubject: `subject-${propertyId}`,
    ...(context.sealGoogleToken && {
      accessToken: context.sealGoogleToken('harness-access-token'),
      refreshToken: context.sealGoogleToken('harness-refresh-token'),
    }),
    tokenExpiresAt: new Date(context.clock().getTime() + 3_600_000),
  })
  const options = google === true ? {} : google
  await context.pool().query(
    `UPDATE properties
        SET google_connection_id = $2, gbp_account_id = $3, gbp_location_id = $4,
            google_binding_state = 'active'
      WHERE id = $1`,
    [
      propertyId,
      connectionId,
      options.accountId ?? `account-${propertyId}`,
      options.locationId ?? `location-${propertyId}`,
    ],
  )
}

export function propertySeeds(context: HarnessSeedContext): PropertySeeds {
  const { pool } = context
  return {
    seedProperty: async (organization, options = {}) => {
      const id = context.newId()
      await pool().query(
        `INSERT INTO properties
           (id, organization_id, name, slug, timezone, default_reply_language, lifecycle_state,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          id,
          organization.id,
          options.name ?? 'Harbour House',
          `harbour-${id}`,
          options.timezone ?? 'UTC',
          options.defaultReplyLanguage ?? null,
          options.lifecycle ?? 'active',
          seededAt(context),
        ],
      )
      if (options.google) await bindGoogle(context, id, organization.id, options.google)
      if (options.reviewDestination) {
        await pool().query(
          `UPDATE properties
              SET google_review_destination_state = 'verified',
                  google_review_uri = $2,
                  google_review_destination_retrieved_at = $3,
                  google_review_destination_source_epoch = source_epoch,
                  google_review_destination_profile_version = profile_version
            WHERE id = $1`,
          [id, `https://g.page/r/harness-${id}/review`, context.clock()],
        )
      }
      return { id, organizationId: organization.id }
    },

    seedPortal: async (property, options = {}) => {
      const id = context.newId()
      const kind = options.kind ?? 'place'
      await pool().query(
        `INSERT INTO portals
           (id, organization_id, property_id, entity_id, name, slug, theme, kind,
            public_name, publication_state, primary_guest_locale,
            additional_guest_locales, skip_private_rating, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, '{"primaryColor":"#6366F1"}', $7, $8, $9, $10,
                 $11::jsonb, $12, $13, $14, $14)`,
        [
          id,
          property.organizationId,
          property.id,
          property.id,
          options.name ?? 'Reception',
          `reception-${id}`,
          kind,
          options.publicName ?? (kind === 'personal' ? 'Harness Host' : null),
          options.state ?? 'draft',
          options.primaryLocale ?? 'en',
          JSON.stringify(options.additionalLocales ?? []),
          options.skipPrivateRating ?? false,
          options.createdBy ?? null,
          seededAt(context),
        ],
      )
      return { id, organizationId: property.organizationId, propertyId: property.id }
    },

    grantProperty: async (member, property) => {
      await pool().query(
        `INSERT INTO property_access_grant (organization_id, property_id, user_id, source, created_by)
         VALUES ($1, $2, $3, 'invitation', $3)`,
        [property.organizationId, property.id, member.userId],
      )
    },
  }
}
