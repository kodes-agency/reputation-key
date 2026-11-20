// Live Portals, Portal groups and staff for the server-function harness.
//
// A published Portal is the rows a publication leaves: the Portal in state
// 'published', its live version (an Immersive Hub snapshot) and open
// activation, an address issued through the Portal's own command (so its print
// codes, access artifacts and sealed copy are the app's), health, and an
// approved secondary link. Its Google review binding is the Property's verified
// destination, so the guest page offers Google as the real reader decides it.

import { getContainer } from '#/composition'
import { STAFF_NOTICE_VERSION } from '#/contexts/identity/domain/staff-account'
import { immersiveSnapshot } from '#/contexts/portal/application/__fixtures__/immersive-snapshot'
import { immersiveConfiguration } from '#/contexts/portal/domain/__fixtures__/immersive-configuration'
import type {
  ImmersivePortalPublicationConfiguration,
  PortalPublicationSnapshot,
} from '#/contexts/portal/domain/portal-publication-snapshot'
import { getDb } from '#/shared/db'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { organizationId, userId } from '#/shared/domain/ids'
import type { TestMember } from './server-function-identity-seeds'
import {
  propertySeeds,
  type SeedPortalOptions,
  type TestPortal,
  type TestProperty,
} from './server-function-property-seeds'
import type { HarnessSeedContext } from './server-function-seed-context'

/**
 * Tables these seeds write, in the order a test file's `cleanupTables` must
 * delete them: each before the rows it references.
 */
export const PORTAL_SEED_CLEANUP_TABLES = [
  'portal_responsibilities',
  'staff_onboardings',
  'staff_property_settings',
  'portal_group_memberships',
  'portal_group_history',
  'portal_groups',
  'staff_participations',
  'staff_user_links',
  'staff_participants',
  'portal_access_artifacts',
  'portal_address_downloads',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_health_intervals',
  'portal_tokens',
  'portal_approved_destinations',
] as const

export type SeedPublishedPortalOptions = SeedPortalOptions &
  Readonly<{
    /** The Portal's address: active (the default), revoked, or none at all. */
    token?: 'active' | 'revoked' | false
    health?: 'healthy' | 'unavailable'
    /** Change the live version's content; its ids and Google binding stay the seed's. */
    configuration?: (
      base: ImmersivePortalPublicationConfiguration,
    ) => ImmersivePortalPublicationConfiguration
    /** 'open' (the default) is live; 'replaced' leaves the Portal with no live version. */
    activation?: 'open' | 'replaced'
  }>

export type TestPublishedPortal = TestPortal &
  Readonly<{
    snapshotId: string
    /**
     * The long guest address, absent when the seed made no address. It is
     * sealed for "Download again" when PORTAL_ADDRESS_ENCRYPTION_KEYS is set.
     */
    rawToken?: string
    tokenId?: string
    printCodes?: Readonly<{ qr: string; nfc: string }>
    /** The approved secondary link on the live page. */
    linkId: string
    linkUrl: string
  }>

export type SeedStaffParticipationOptions = Readonly<{
  displayName?: string
  /** The person's personal Portal; one is made (draft) when absent, `null` makes none. */
  personalPortal?: TestPortal | null
  /** Link the person to the member's login. Default true. */
  linkUser?: boolean
  /** Whether the member has acknowledged the staff notice. Default true. */
  noticeAcknowledged?: boolean
  colleagueListEnabled?: boolean
}>

export type TestStaffParticipation = Readonly<{
  participantId: string
  participationId: string
  personalPortal: TestPortal | null
}>

export type PortalSeeds = Readonly<{
  /** A Portal a guest can open: live version, address, print codes, health and a link. */
  seedPublishedPortal: (
    property: TestProperty,
    options?: SeedPublishedPortalOptions,
  ) => Promise<TestPublishedPortal>
  seedPortalGroup: (
    property: TestProperty,
    portals: readonly TestPortal[],
    options?: Readonly<{ name?: string }>,
  ) => Promise<Readonly<{ id: string }>>
  /** The member as a staff person at the Property, with a personal Portal. */
  seedStaffParticipation: (
    member: TestMember,
    property: TestProperty,
    options?: SeedStaffParticipationOptions,
  ) => Promise<TestStaffParticipation>
}>

/**
 * A second before the container's clock, at the millisecond precision the app
 * reads: commands fence on the updated_at they read and must move it forward.
 */
function seededAt(context: HarnessSeedContext): Date {
  return new Date(context.clock().getTime() - 1000)
}

type Destination = Readonly<{
  uri: string
  retrievedAt: Date
  sourceEpoch: number
  profileVersion: number
}>

/** The Property's verified Google destination, made verified when it was not. */
async function verifiedDestination(
  context: HarnessSeedContext,
  property: TestProperty,
): Promise<Destination> {
  await context.pool().query(
    `UPDATE properties
        SET google_review_destination_state = 'verified',
            google_review_uri = $2,
            google_review_destination_retrieved_at = $3,
            google_review_destination_source_epoch = source_epoch,
            google_review_destination_profile_version = profile_version
      WHERE id = $1 AND google_review_destination_state = 'unavailable'`,
    [property.id, `https://g.page/r/harness-${property.id}/review`, context.clock()],
  )
  const { rows } = await context.pool().query<{
    uri: string
    retrieved_at: Date
    source_epoch: number
    profile_version: number
  }>(
    `SELECT google_review_uri AS uri,
            google_review_destination_retrieved_at AS retrieved_at,
            google_review_destination_source_epoch AS source_epoch,
            google_review_destination_profile_version AS profile_version
       FROM properties WHERE id = $1`,
    [property.id],
  )
  const [row] = rows
  if (!row) throw new Error(`No Property ${property.id}`)
  return {
    uri: row.uri,
    retrievedAt: row.retrieved_at,
    sourceEpoch: row.source_epoch,
    profileVersion: row.profile_version,
  }
}

type Address = Readonly<{
  rawToken: string
  tokenId: string
  printCodes?: Readonly<{ qr: string; nfc: string }>
}>

/** The print code at the end of a printed address, or undefined for a long address. */
function printCodeOf(url: string): string | undefined {
  const code = new URL(url).pathname.split('/p/')[1]
  return code && !code.includes('_') ? code : undefined
}

/** Issue the Portal's address as an Account Admin's "Make code" does. */
async function seedAddress(
  context: HarnessSeedContext,
  portal: TestPortal,
  options: SeedPublishedPortalOptions,
): Promise<Address | undefined> {
  const status = options.token ?? 'active'
  if (status === false) return undefined
  const issued = await getContainer().portalPublicApi.management.issuePortalToken(
    { portalId: portal.id },
    {
      userId: userId('harness-publisher'),
      organizationId: organizationId(portal.organizationId),
      role: 'AccountAdmin',
    },
  )
  const { rows } = await context
    .pool()
    .query<{ id: string }>(
      `SELECT id FROM portal_tokens WHERE portal_id = $1 AND token_identifier = $2`,
      [portal.id, issued.tokenIdentifier],
    )
  const tokenId = rows[0]?.id
  if (!tokenId) throw new Error(`No address was issued for Portal ${portal.id}`)
  if (status === 'revoked') {
    await context.pool().query(
      `UPDATE portal_tokens
          SET status = 'revoked', revoked_at = $2, revoked_by = 'harness',
              revoked_reason = 'harness', encrypted_raw_token = NULL,
              address_encryption_key_version = NULL
        WHERE id = $1`,
      [tokenId, context.clock()],
    )
  }
  const qr = printCodeOf(issued.publicUrls.qr)
  const nfc = printCodeOf(issued.publicUrls.nfc)
  return {
    rawToken: issued.rawToken,
    tokenId,
    ...(qr && nfc ? { printCodes: { qr, nfc } } : {}),
  }
}

async function seedHealthAndLink(
  context: HarnessSeedContext,
  portal: TestPortal,
  health: 'healthy' | 'unavailable',
  linkUrl: string,
): Promise<void> {
  const at = seededAt(context)
  await context.pool().query(
    `INSERT INTO portal_health_intervals
       (id, organization_id, property_id, portal_id, status, reason, source_version,
        effective_from, observed_at)
     VALUES ($1, $2, $3, $4, $5, 'operational', '1', $6, $6)`,
    [context.newId(), portal.organizationId, portal.propertyId, portal.id, health, at],
  )
  await context.pool().query(
    `INSERT INTO portal_approved_destinations
       (id, organization_id, property_id, normalized_uri, hostname, source_type,
        approval_state, validation_version, requested_by, approved_by, approved_at,
        last_validated_at)
     VALUES ($1, $2, $3, $4, $5, 'custom', 'approved', 'v1', 'harness', 'harness', $6, $6)
     ON CONFLICT DO NOTHING`,
    [
      context.newId(),
      portal.organizationId,
      portal.propertyId,
      linkUrl,
      new URL(linkUrl).hostname,
      at,
    ],
  )
}

function liveConfiguration(
  portal: TestPortal,
  destination: Destination,
  options: SeedPublishedPortalOptions,
  link: Readonly<{ id: string; url: string }>,
): ImmersivePortalPublicationConfiguration {
  const base = immersiveConfiguration()
  const [menu] = base.links
  if (!menu) throw new Error('The Immersive fixture has no link to reuse')
  const seeded = immersiveConfiguration({
    portal: { id: portal.id, slug: `reception-${portal.id}` },
    links: [{ ...menu, id: link.id, url: link.url, imageAssetId: null }],
    brandProfile: { ...base.brandProfile, logo: null, hero: null },
    reviewGateway: {
      privateFeedbackThreshold: 3,
      googleReview: { status: 'available', uri: destination.uri },
      ...(options.skipPrivateRating ? { skipPrivateRating: true } : {}),
    },
    googleReviewBinding: {
      retrievedAt: destination.retrievedAt.toISOString(),
      sourceEpoch: destination.sourceEpoch,
      profileVersion: destination.profileVersion,
    },
  })
  return options.configuration?.(seeded) ?? seeded
}

/** The row a publication stores for an Immersive Hub version. */
function snapshotRow(
  snapshot: PortalPublicationSnapshot,
  configuration: ImmersivePortalPublicationConfiguration,
): typeof portalPublicationSnapshots.$inferInsert {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    portalId: snapshot.portalId,
    version: snapshot.version,
    configurationDigest: snapshot.configurationDigest,
    configuration,
    guestLocale: configuration.guestLocale,
    languagePackVersion: configuration.languagePackVersion,
    localeSet: configuration.localeSet,
    languagePackVersions: configuration.languagePackVersions,
    localizedContent: configuration.localizedContent,
    brandProfileVersion: configuration.brandProfile.lookVersion,
    privateFeedbackThreshold: configuration.reviewGateway.privateFeedbackThreshold,
    destinationUri: snapshot.destinationUri,
    destinationRetrievedAt: snapshot.destinationRetrievedAt,
    destinationSourceEpoch: snapshot.destinationSourceEpoch,
    destinationProfileVersion: snapshot.destinationProfileVersion,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
  }
}

async function seedLiveVersion(
  context: HarnessSeedContext,
  portal: TestPortal,
  configuration: ImmersivePortalPublicationConfiguration,
  open: boolean,
): Promise<string> {
  const at = seededAt(context)
  const snapshot = immersiveSnapshot(configuration, {
    id: context.newId(),
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.id,
    version: 1,
    createdBy: 'harness',
    createdAt: at,
  })
  const db = getDb()
  await db.insert(portalPublicationSnapshots).values(snapshotRow(snapshot, configuration))
  await db.insert(portalPublicationActivations).values({
    id: context.newId(),
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.id,
    snapshotId: snapshot.id,
    activationSequence: 1,
    kind: 'publish',
    activatedBy: 'harness',
    activatedAt: at,
    deactivatedAt: open ? null : new Date(at.getTime() + 1),
    deactivationReason: open ? null : 'replaced',
  })
  return snapshot.id
}

export function portalSeeds(context: HarnessSeedContext): PortalSeeds {
  const { pool } = context
  const { seedPortal } = propertySeeds(context)

  return {
    seedPublishedPortal: async (property, options = {}) => {
      const destination = await verifiedDestination(context, property)
      const portal = await seedPortal(property, {
        additionalLocales: ['bg'],
        ...options,
        state: options.state ?? 'published',
      })
      const link = {
        id: context.newId(),
        url: `https://links-${portal.id.slice(0, 8)}.example.com/menu`,
      }
      const configuration = liveConfiguration(portal, destination, options, link)
      const snapshotId = await seedLiveVersion(
        context,
        portal,
        configuration,
        (options.activation ?? 'open') === 'open',
      )
      await seedHealthAndLink(context, portal, options.health ?? 'healthy', link.url)
      const address = await seedAddress(context, portal, options)
      return { ...portal, ...address, snapshotId, linkId: link.id, linkUrl: link.url }
    },

    seedPortalGroup: async (property, portals, options = {}) => {
      const id = context.newId()
      await pool().query(
        `INSERT INTO portal_groups
           (id, organization_id, property_id, name, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'harness', $5, $5)`,
        [
          id,
          property.organizationId,
          property.id,
          options.name ?? `Desk ${id.slice(0, 8)}`,
          seededAt(context),
        ],
      )
      for (const portal of portals) {
        await pool().query(
          `INSERT INTO portal_group_memberships
             (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
           VALUES ($1, $2, $3, $4, $5, 'harness')`,
          [property.organizationId, property.id, portal.id, id, seededAt(context)],
        )
      }
      return { id }
    },

    seedStaffParticipation: async (member, property, options = {}) => {
      const displayName = options.displayName ?? 'Polly Smith'
      const participantId = context.newId()
      const participationId = context.newId()
      const personalPortal =
        options.personalPortal === undefined
          ? await seedPortal(property, {
              kind: 'personal',
              name: displayName,
              publicName: 'Harbor',
            })
          : options.personalPortal
      const at = seededAt(context)
      await pool().query(
        `INSERT INTO staff_participants
           (id, organization_id, display_name, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'harness', $4, $4)`,
        [participantId, property.organizationId, displayName, at],
      )
      await pool().query(
        `INSERT INTO staff_participations
           (id, organization_id, property_id, staff_participant_id, personal_portal_id,
            display_name, started_at, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'harness', $7, $7)`,
        [
          participationId,
          property.organizationId,
          property.id,
          participantId,
          personalPortal?.id ?? null,
          displayName,
          at,
        ],
      )
      if (options.linkUser ?? true) {
        const acknowledged = options.noticeAcknowledged ?? true
        await pool().query(
          `INSERT INTO staff_user_links
             (organization_id, staff_participant_id, user_id, effective_from, created_by,
              notice_version, notice_acknowledged_at)
           VALUES ($1, $2, $3, $4, 'harness', $5, $6)`,
          [
            property.organizationId,
            participantId,
            member.userId,
            new Date(at.getTime() - 60_000),
            acknowledged ? STAFF_NOTICE_VERSION : null,
            acknowledged ? at : null,
          ],
        )
      }
      if (options.colleagueListEnabled !== undefined) {
        await pool().query(
          `INSERT INTO staff_property_settings
             (organization_id, property_id, colleague_list_enabled, updated_by)
           VALUES ($1, $2, $3, 'harness')
           ON CONFLICT (organization_id, property_id)
           DO UPDATE SET colleague_list_enabled = EXCLUDED.colleague_list_enabled`,
          [property.organizationId, property.id, options.colleagueListEnabled],
        )
      }
      return { participantId, participationId, personalPortal }
    },
  }
}
