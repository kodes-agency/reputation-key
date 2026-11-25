// The public Portal read and the review-link redirect, over a real published
// Portal: its live version, its address, its health interval and the Property's
// approved destinations are rows, and a click lands as a durable outbox fact.
// Only the Property's lifecycle and Google destination (another context's
// answers) and the public execution decision are stood in for.

import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId, portalLinkId } from '#/shared/domain/ids'
import { portalPublicationSnapshots } from '#/shared/db/schema/portal-publication.schema'
import { portalPublicationActivations } from '#/shared/db/schema/portal-publication.schema'
import { createPortalTokenCodec } from '#/contexts/portal/addresses/portal-token-codec.server'
import { createPortalPublicationRepository } from '#/contexts/portal/publication/portal-publication-repository.server'
import { createPortalHealthRepository } from '#/contexts/portal/health/portal-health-repository.server'
import { createPortalApprovedDestinationRepository } from '#/contexts/portal/destinations/portal-approved-destination-repository.server'
import { snapshotToRow } from '#/contexts/portal/publication/portal-publication-commands.server'
import { immersiveSnapshot } from '#/contexts/portal/application/__fixtures__/immersive-snapshot'
import { immersiveConfiguration } from '#/contexts/portal/domain/__fixtures__/immersive-configuration'
import { resolvePublicPortalToken } from '#/contexts/portal/publication/resolve-public-portal-token.server'
import { quietGuestReadDeps } from '#/contexts/portal/publication/resolve-public-portal-token.test-fixtures'
import type { PortalPublicApi } from '#/contexts/portal/public-api'
import { createAtomicGuestObservationStore } from './guest-observation-store.server'
import { getPublicPortal } from './get-public-portal.server'
import { findPortalLink, resolvePortalLink } from './resolve-portal-link.server'
import { trackReviewLinkClick } from './track-review-link-click.server'
import { isGuestError } from '../domain/errors'

const db = getDb()
const NOW = new Date('2026-10-01T12:00:00.000Z')
const SESSION_EXPIRES_AT = new Date('2026-10-02T12:00:00.000Z')
const ORG = `org-public-links-${randomUUID()}`
const OTHER_ORG = `org-public-links-other-${randomUUID()}`
const GOOGLE_URI = 'https://search.google.com/local/writereview?placeid=public-links'

const codec = createPortalTokenCodec({
  secret: randomBytes(40).toString('hex'),
  randomBytes,
})

type Seeded = Readonly<{
  org: string
  property: string
  portal: string
  rawToken: string
  linkId: string
  linkUrl: string
}>

type SeedOptions = Readonly<{
  health?: 'healthy' | 'unavailable'
  publicationState?: 'published' | 'disabled'
  tokenStatus?: 'active' | 'revoked'
}>

async function seedPublishedPortal(
  org: string,
  options: SeedOptions = {},
): Promise<Seeded> {
  const property = randomUUID()
  const portal = randomUUID()
  const linkId = randomUUID()
  const linkUrl = `https://links-${portal.slice(0, 8)}.example.com/menu`
  const issued = codec.issue()
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${property}, ${org}, 'Public Links Property', ${property}, 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (${portal}, ${org}, ${property}, 'property', ${property},
      'Public Links Portal', ${portal}, ${options.publicationState ?? 'published'})
  `)
  await db.execute(sql`
    INSERT INTO portal_tokens (
      id, organization_id, property_id, portal_id, token_identifier, token_hash,
      token_key_version, version, status, issued_at
    ) VALUES (${randomUUID()}::uuid, ${org}, ${property}, ${portal},
      ${issued.tokenIdentifier}, ${issued.tokenHash}, ${issued.tokenKeyVersion},
      1, ${options.tokenStatus ?? 'active'}, ${NOW})
  `)
  await db.execute(sql`
    INSERT INTO portal_health_intervals (
      id, organization_id, property_id, portal_id, status, reason,
      source_version, effective_from, observed_at
    ) VALUES (${randomUUID()}::uuid, ${org}, ${property}, ${portal}, ${options.health ?? 'healthy'},
      'operational', '1', ${NOW}, ${NOW})
  `)
  await db.execute(sql`
    INSERT INTO portal_approved_destinations (
      id, organization_id, property_id, normalized_uri, hostname, source_type,
      approval_state, validation_version, requested_by, approved_by, approved_at,
      last_validated_at
    ) VALUES (${randomUUID()}::uuid, ${org}, ${property}, ${linkUrl},
      ${new URL(linkUrl).hostname}, 'custom', 'approved', 'v1', 'manager-1',
      'manager-1', ${NOW}, ${NOW})
  `)
  const base = immersiveConfiguration()
  const [menu] = base.links
  if (!menu) throw new Error('immersive fixture has no link to reuse')
  const snapshot = immersiveSnapshot(
    immersiveConfiguration({
      portal: { id: portal, slug: `slug-${portal.slice(0, 8)}` },
      links: [{ ...menu, id: linkId, url: linkUrl, imageAssetId: null }],
      brandProfile: { ...base.brandProfile, logo: null, hero: null },
      reviewGateway: {
        privateFeedbackThreshold: 3,
        googleReview: { status: 'available', uri: GOOGLE_URI },
      },
    }),
    {
      id: randomUUID(),
      organizationId: org,
      propertyId: property,
      portalId: portal,
      version: 1,
      createdAt: NOW,
    },
  )
  await db.insert(portalPublicationSnapshots).values(snapshotToRow(snapshot))
  await db.insert(portalPublicationActivations).values({
    id: randomUUID(),
    organizationId: org,
    propertyId: property,
    portalId: portal,
    snapshotId: snapshot.id,
    activationSequence: 1,
    kind: 'publish',
    activatedBy: 'manager-1',
    activatedAt: NOW,
    deactivatedAt: null,
    deactivationReason: null,
  })
  return { org, property, portal, rawToken: issued.rawToken, linkId, linkUrl }
}

type Gate = { allowed: boolean }

/** The real public read, over the real stores; `gate` is the public execution decision. */
const publicLookup = (gate: Gate): PortalPublicApi['findPublicPortalByToken'] =>
  resolvePublicPortalToken({
    tokenCodec: codec,
    portalPublicationRepo: createPortalPublicationRepository(db),
    portalHealthRepo: createPortalHealthRepository(db),
    listApprovedSecondaryDestinationUris:
      createPortalApprovedDestinationRepository(db).listApprovedUris,
    isPropertyActive: async () => true,
    getGoogleReviewDestination: async () => ({
      state: 'verified' as const,
      uri: GOOGLE_URI,
      retrievedAt: new Date(immersiveConfiguration().googleReviewBinding.retrievedAt),
      sourceEpoch: immersiveConfiguration().googleReviewBinding.sourceEpoch,
      profileVersion: immersiveConfiguration().googleReviewBinding.profileVersion,
    }),
    decidePublic: async () => gate,
    ...quietGuestReadDeps,
    clock: () => NOW,
  })

const clickFacts = async (org: string) => {
  const rows = await db.execute(sql`
    SELECT payload FROM outbox_events
    WHERE organization_id = ${org} AND event_type = 'guest.review_link.clicked'
    ORDER BY created_at, id
  `)
  return rows.rows.map((row) => row.payload)
}

const clickReceipts = async (org: string) => {
  const rows = await db.execute(sql`
    SELECT payload FROM idempotency_receipts
    WHERE scope = 'guest_destination_action' AND key LIKE ${`%${org}%`}
    ORDER BY recorded_at, key
  `)
  return rows.rows.map((row) => row.payload)
}

const redirector = (gate: Gate) =>
  resolvePortalLink({ findPublicPortalByToken: publicLookup(gate) })

const tracker = (losses: string[] = []) =>
  trackReviewLinkClick({
    observationStore: createAtomicGuestObservationStore(db),
    clock: () => NOW,
    reportObservationLoss: async (kind) => {
      losses.push(kind)
      return 'recorded' as const
    },
  })

let own: Seeded
let other: Seeded

beforeAll(async () => {
  for (const id of [ORG, OTHER_ORG]) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${id}, 'Public Links', ${id}, now())
    `)
  }
  own = await seedPublishedPortal(ORG)
  other = await seedPublishedPortal(OTHER_ORG)
})

afterAll(async () => {
  for (const id of [ORG, OTHER_ORG]) {
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${id}`)
    await db.execute(sql`
      DELETE FROM idempotency_receipts
      WHERE scope = 'guest_destination_action' AND key LIKE ${`%${id}%`}
    `)
    for (const table of [
      'portal_publication_activations',
      'portal_publication_snapshots',
      'portal_approved_destinations',
      'portal_health_intervals',
      'portal_tokens',
      'portals',
      'properties',
    ]) {
      await db.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${id}`,
      )
    }
  }
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
})

describe('getPublicPortal', () => {
  it('serves the live Portal for its address, with only approved links and the Google gateway', async () => {
    const result = await getPublicPortal({
      findPublicPortalByToken: publicLookup({ allowed: true }),
    })({
      token: own.rawToken,
    })

    expect(result).toMatchObject({
      organizationId: ORG,
      propertyId: own.property,
      portal: { id: own.portal },
      reviewGateway: { googleReview: { status: 'available', uri: GOOGLE_URI } },
    })
    expect(result.links.map((link) => link.id)).toEqual([own.linkId])
  })

  it('serves the language of the signed session over the browser header', async () => {
    const result = await getPublicPortal({
      findPublicPortalByToken: publicLookup({ allowed: true }),
    })({
      token: own.rawToken,
      preference: { requestedLocale: null, sessionLocale: 'bg', acceptLanguage: 'en-US' },
    })

    expect(result.localization.selectedLocale).toBe('bg')
  })

  it('hands the admitted scope to the preference before choosing a language', async () => {
    const scopes: unknown[] = []
    const result = await getPublicPortal({
      findPublicPortalByToken: publicLookup({ allowed: true }),
    })({
      token: own.rawToken,
      preference: (scope) => {
        scopes.push(scope)
        return { sessionLocale: 'bg', acceptLanguage: 'en-US' }
      },
    })

    expect(scopes).toEqual([
      { organizationId: ORG, propertyId: own.property, portalId: own.portal },
    ])
    expect(result.localization.selectedLocale).toBe('bg')
  })

  it('answers portal_not_found for an address that names no Portal', async () => {
    await expect(
      getPublicPortal({ findPublicPortalByToken: publicLookup({ allowed: true }) })({
        token: `pt_${'A'.repeat(16)}_${'B'.repeat(43)}`,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGuestError(error) && error.code === 'portal_not_found',
    )
  })

  it('answers portal_not_found when the public execution decision refuses the read', async () => {
    await expect(
      getPublicPortal({ findPublicPortalByToken: publicLookup({ allowed: false }) })({
        token: own.rawToken,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isGuestError(error) && error.code === 'portal_not_found',
    )
  })
})

describe('a Portal that must stay closed', () => {
  const cases: ReadonlyArray<readonly [string, SeedOptions]> = [
    ['its health is unavailable', { health: 'unavailable' }],
    ['it is disabled', { publicationState: 'disabled' }],
    ['its address was revoked', { tokenStatus: 'revoked' }],
  ]

  it.each(cases)(
    'serves nothing, and records no click, when %s',
    async (_name, options) => {
      const closed = await seedPublishedPortal(ORG, options)

      await expect(
        getPublicPortal({ findPublicPortalByToken: publicLookup({ allowed: true }) })({
          token: closed.rawToken,
        }),
      ).rejects.toSatisfy(
        (error: unknown) => isGuestError(error) && error.code === 'portal_not_found',
      )
      await expect(
        redirector({ allowed: true })({
          token: closed.rawToken,
          linkId: portalLinkId(closed.linkId),
        }),
      ).resolves.toBeNull()
    },
  )
})

describe('resolvePortalLink (token-bound public redirect)', () => {
  const link = () => portalLinkId(own.linkId)

  it('resolves a link of the token Portal without recording anything for a GET', async () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#1
    await expect(
      redirector({ allowed: true })({ token: own.rawToken, linkId: link() }),
    ).resolves.toEqual({ url: own.linkUrl })

    expect(await clickFacts(ORG)).toEqual([])
  })

  it('answers null for an unavailable address or a refused read', async () => {
    const before = await clickFacts(ORG)

    await expect(
      redirector({ allowed: true })({
        token: `pt_${'C'.repeat(16)}_${'D'.repeat(43)}`,
        linkId: link(),
      }),
    ).resolves.toBeNull()
    await expect(
      redirector({ allowed: false })({ token: own.rawToken, linkId: link() }),
    ).resolves.toBeNull()

    expect(await clickFacts(ORG)).toEqual(before)
  })

  it('refuses a link of another Portal forged under this token, and records nothing', async () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#2
    const before = await clickFacts(ORG)
    const beforeOther = await clickFacts(OTHER_ORG)

    await expect(
      redirector({ allowed: true })({
        token: own.rawToken,
        linkId: portalLinkId(other.linkId),
      }),
    ).resolves.toBeNull()
    const portal = await getPublicPortal({
      findPublicPortalByToken: publicLookup({ allowed: true }),
    })({ token: own.rawToken })
    expect(findPortalLink(portal, other.linkId)).toBeNull()
    expect(findPortalLink(portal, own.linkId)).toEqual(
      expect.objectContaining({ url: own.linkUrl }),
    )

    expect(await clickFacts(ORG)).toEqual(before)
    expect(await clickFacts(OTHER_ORG)).toEqual(beforeOther)
  })
})

describe('trackReviewLinkClick (qualified secondary-link action)', () => {
  const click = (sessionId: string, sessionExpiresAt: Date) => ({
    linkId: portalLinkId(own.linkId),
    destinationKind: 'secondary_link' as const,
    sessionId,
    sessionExpiresAt,
    organizationId: organizationId(ORG),
    propertyId: propertyId(own.property),
    portalId: portalId(own.portal),
  })

  it('records a click for a signed-session mutation', async () => {
    const sessionId = randomUUID()
    await tracker()(click(sessionId, SESSION_EXPIRES_AT))

    expect(await clickFacts(ORG)).toMatchObject([
      {
        linkId: own.linkId,
        destinationKind: 'secondary_link',
        organizationId: ORG,
        propertyId: own.property,
        portalId: own.portal,
      },
    ])
    expect(await clickReceipts(ORG)).toEqual([
      {
        organizationId: ORG,
        propertyId: own.property,
        portalId: own.portal,
        sessionId,
        destinationId: own.linkId,
        destinationKind: 'secondary_link',
        expiresAt: SESSION_EXPIRES_AT.toISOString(),
      },
    ])
  })

  it('reports the loss, and does not throw, when the store refuses the click', async () => {
    // A session that ended before the click is refused by the real store.
    const before = await clickFacts(ORG)
    const receipts = await clickReceipts(ORG)
    const losses: string[] = []

    await expect(
      tracker(losses)(click(randomUUID(), new Date(NOW.getTime() - 1_000))),
    ).resolves.toBeUndefined()

    expect(losses).toEqual(['review_link'])
    expect(await clickFacts(ORG)).toEqual(before)
    expect(await clickReceipts(ORG)).toEqual(receipts)
  })
})
