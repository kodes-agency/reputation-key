// Two Portals of one Property, one with a look of its own (ADR 0070), published
// and served the way a guest and the print kit read them, against real PostgreSQL.
//
// The guest page and the print kit read only the Portal's live snapshot, so a
// Portal's own look reaches them only through a publication, and a Portal that
// follows the Property is served exactly as before. The guest code does not
// change with this feature; these tests prove the chain it reads: the working
// copy, the committed snapshot, and what the public edge serves from it (the
// brand and its colours, the photo the page and og:image draw, the photo's
// description and the response digests).

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalId, propertyId, type PortalId } from '#/shared/domain/ids'
import { resolvePortalMediaUrls } from '../application/resolve-portal-media-urls'
import { loadPortalPrintKitContext } from '../application/load-portal-print-kit-context'
import { rollbackPortalPublication } from '../application/use-cases/rollback-portal-publication'
import {
  resolvePublicPortalToken,
  type ResolvePublicPortalTokenDeps,
} from '../application/use-cases/resolve-public-portal-token'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createPortalRepository } from './repositories/portal.repository'
import {
  seedPortalLookOverride,
  seedPortalWorkingCopy,
  seedSiblingPortal,
} from './testing/portal-working-copy-seed'
import {
  publishFromSource,
  republishFromSource,
  workingCopyDiffersFromLive,
} from './testing/portal-working-copy-publish'
import {
  COMPLETE_SCENARIO,
  OWN_COLOURS_LOOK,
  OWN_EVERYTHING_LOOK,
  SCENARIO_HERO_ASSET,
  SCENARIO_OWN_HERO_ASSET,
  SCENARIO_OWN_LOGO_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
  withOwnLook,
  type WorkingCopyScenario,
} from './testing/portal-working-copy-scenarios'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_localized_overrides',
    'portal_look_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const NOW = new Date('2026-10-01T12:00:00.000Z')
const SPA = portalId('c2000000-0000-4000-8000-0000000000a1')
/** The Property's images, and the others a Portal can take as its own. */
const PROPERTY: WorkingCopyScenario = {
  ...COMPLETE_SCENARIO,
  mediaAssets: withOwnLook(OWN_EVERYTHING_LOOK).mediaAssets,
}
const RECEPTION = PROPERTY.portalId

const scopeOf = (id: PortalId) => ({
  organizationId: PROPERTY.organizationId,
  propertyId: PROPERTY.propertyId,
  portalId: id,
})

const publicationRepo = () => createPortalPublicationRepository(getDb())

async function publish(id: PortalId): Promise<void> {
  const source = await publicationRepo().loadWorkingCopy(PROPERTY.organizationId, id)
  if (!source) throw new Error('the Portal has no working copy')
  await publishFromSource(scopeOf(id), source)
}

/** The public edge, over the Portal's real live snapshot and the real image store. */
async function serve(id: PortalId) {
  const snapshot = await publicationRepo().findActiveForPortal(
    organizationId(PROPERTY.organizationId),
    id,
  )
  if (!snapshot) throw new Error('the Portal is not live')
  const deps: ResolvePublicPortalTokenDeps = {
    tokenCodec: {
      digest: () => ({
        kind: 'long',
        tokenIdentifier: 'key',
        tokenHash: 'hash',
        tokenKeyVersion: 1,
      }),
    },
    portalPublicationRepo: {
      resolveActiveByTokenDigest: async () => ({
        token: { ...scopeOf(id), version: 1 },
        snapshot,
      }),
    },
    portalHealthRepo: {
      getCurrent: async () => ({
        id: 'health-1',
        organizationId: organizationId(PROPERTY.organizationId),
        propertyId: propertyId(PROPERTY.propertyId),
        portalId: id,
        status: 'healthy' as const,
        reason: 'operational' as const,
        sourceVersion: '1',
        effectiveFrom: NOW,
        effectiveTo: null,
        observedAt: NOW,
      }),
    },
    listApprovedSecondaryDestinationUris: async (_org, _property, uris) => uris,
    isPropertyActive: async () => true,
    getGoogleReviewDestination: async () => ({
      state: 'verified' as const,
      uri: snapshot.destinationUri,
      retrievedAt: snapshot.destinationRetrievedAt,
      sourceEpoch: snapshot.destinationSourceEpoch,
      profileVersion: snapshot.destinationProfileVersion,
    }),
    decidePublic: async () => ({ allowed: true }),
    resolvePortalMediaUrls: resolvePortalMediaUrls({
      mediaRepo: createPortalMediaAssetRepository(getDb()),
    }),
    clock: () => NOW,
  }
  const outcome = await resolvePublicPortalToken(deps)('pt_look_secret')
  if (outcome.status !== 'found') throw new Error('expected a served Portal')
  return outcome.data
}

/** Reception follows the Property; Spa, a second Portal of it, has a look of its own. */
async function seedTwoPortals(): Promise<void> {
  await seedPortalWorkingCopy(getPool(), PROPERTY)
  await seedSiblingPortal(getPool(), PROPERTY, { portalId: SPA, slug: 'spa' })
}

const mediaPath = (assetId: string) => `/api/public/portal-media/${assetId}`

describe.sequential('two Portals of one Property, one with a look of its own', () => {
  it('serves each its own brand, colours, photo, description and digests', async () => {
    await seedTwoPortals()
    await seedPortalLookOverride(getPool(), scopeOf(SPA), OWN_EVERYTHING_LOOK)
    await publish(RECEPTION)
    await publish(SPA)

    const reception = await serve(RECEPTION)
    const spa = await serve(SPA)

    // Reception: the Property's look.
    expect(reception.immersive?.brand).toMatchObject({
      displayName: 'Hotel Rila',
      wordmark: 'RILA',
      accentColour: '#1D4ED8',
      fieldColour: '#101820',
      hero: { url: mediaPath(SCENARIO_HERO_ASSET), focalX: 0.3, focalY: 0.7 },
    })
    expect(reception.immersive?.content.heroAlt.value).toBe('Фасадата на хотела')
    // Spa: its own photo, colours, name and logo; the public name is still the Property's.
    expect(spa.immersive?.brand).toMatchObject({
      displayName: 'Hotel Rila',
      wordmark: 'SPA',
      accentColour: '#B8860B',
      logo: { url: mediaPath(SCENARIO_OWN_LOGO_ASSET), width: 300, height: 300 },
      hero: {
        url: mediaPath(SCENARIO_OWN_HERO_ASSET),
        width: 1200,
        height: 800,
        focalX: 0.2,
        focalY: 0.4,
      },
    })
    expect(spa.immersive?.brand.fieldColour).not.toBe(
      reception.immersive?.brand.fieldColour,
    )
    expect(spa.immersive?.content.heroAlt.value).toBe('Басейнът')
    // The page's og:image is the photo it draws.
    expect(reception.portal.heroImageUrl).toBe(mediaPath(SCENARIO_HERO_ASSET))
    expect(spa.portal.heroImageUrl).toBe(mediaPath(SCENARIO_OWN_HERO_ASSET))
    expect(spa.portal.logoUrl).toBe(mediaPath(SCENARIO_OWN_LOGO_ASSET))
    // Different looks are different publications.
    expect(spa.responseConfiguration.configurationDigest).not.toBe(
      reception.responseConfiguration.configurationDigest,
    )
    expect(spa.responseConfiguration.publicationDigest).not.toBe(
      reception.responseConfiguration.publicationDigest,
    )
  })

  it('serves a Portal that follows the Property exactly as before another Portal had a look of its own', async () => {
    await seedTwoPortals()
    await publish(RECEPTION)
    const before = await serve(RECEPTION)

    await seedPortalLookOverride(getPool(), scopeOf(SPA), OWN_EVERYTHING_LOOK)
    await publish(SPA)
    const after = await serve(RECEPTION)

    expect(after).toEqual(before)
    expect(after.responseConfiguration.configurationDigest).toBe(
      before.responseConfiguration.configurationDigest,
    )
    expect(after.responseConfiguration.publicationDigest).toBe(
      before.responseConfiguration.publicationDigest,
    )
  })

  it('serves the same look and digest to a Portal with a row that follows every group as to one with none', async () => {
    await seedTwoPortals()
    // A row at the Property's version that owns nothing.
    await seedPortalLookOverride(getPool(), scopeOf(SPA), { lookVersion: 4 })
    await publish(RECEPTION)
    await publish(SPA)

    const reception = await serve(RECEPTION)
    const spa = await serve(SPA)

    expect(spa.immersive?.brand).toEqual(reception.immersive?.brand)
    expect(spa.immersive?.content.heroAlt).toEqual(reception.immersive?.content.heroAlt)
    expect(spa.portal.heroImageUrl).toBe(reception.portal.heroImageUrl)
    expect(spa.portal.logoUrl).toBe(reception.portal.logoUrl)
  })

  it('serves no photograph, and no og:image, once the Portal’s own photo is taken down', async () => {
    await seedTwoPortals()
    await seedPortalLookOverride(getPool(), scopeOf(SPA), OWN_EVERYTHING_LOOK)
    await publish(SPA)
    await getPool().query(
      `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW()
        WHERE id = $1`,
      [SCENARIO_OWN_HERO_ASSET],
    )

    const spa = await serve(SPA)

    expect(spa.immersive?.brand.hero).toBeNull()
    expect(spa.portal.heroImageUrl).toBeNull()
  })
})

describe.sequential('making an earlier version live again', () => {
  it('serves the look that version was published with, and leaves the Portal’s own look alone', async () => {
    await seedTwoPortals()
    await seedPortalLookOverride(getPool(), scopeOf(SPA), OWN_COLOURS_LOOK)
    await publish(SPA)
    await getPool().query(
      `UPDATE portal_look_overrides SET primary_color = '#112233', look_version = 6
        WHERE portal_id = $1`,
      [SPA],
    )
    const source = await publicationRepo().loadWorkingCopy(
      organizationId(PROPERTY.organizationId),
      SPA,
    )
    if (!source) throw new Error('the Portal has no working copy')
    await republishFromSource(scopeOf(SPA), source)
    await expect(serve(SPA)).resolves.toMatchObject({
      immersive: { brand: { accentColour: '#112233' } },
    })
    const row = () =>
      getPool().query(`SELECT * FROM portal_look_overrides WHERE portal_id = $1`, [SPA])
    const before = await row()

    // The manager takes the first version live again ("Make live again").
    await rollbackPortalPublication({
      portalRepo: createPortalRepository(getDb()),
      publicationRepo: publicationRepo(),
      commandStore: createAtomicPortalCommandStore(getDb()),
      staffPublicApi: {
        getAccessiblePropertyIds: async () => null,
        getAssignedPortals: async () => [],
      },
      idGen: () => '6f000000-0000-4000-8000-0000000000a1',
      clock: () => NOW,
    })(
      { portalId: SPA, version: 1 },
      buildTestAuthContext({
        organizationId: organizationId(PROPERTY.organizationId),
        role: 'AccountAdmin',
      }),
    )

    // The page is the first version's frozen look; the row is exactly as it was.
    await expect(serve(SPA)).resolves.toMatchObject({
      immersive: { brand: { accentColour: '#B8860B' } },
    })
    expect((await row()).rows).toEqual(before.rows)
    // The working copy still has the Portal's own look, which the live version lacks.
    await expect(workingCopyDiffersFromLive(scopeOf(SPA))).resolves.toBe(true)
  })
})

describe.sequential('the print kit of two Portals of one Property', () => {
  const printKitOf = async (id: PortalId) => {
    const portal = await createPortalRepository(getDb()).findById(
      organizationId(PROPERTY.organizationId),
      id,
    )
    if (!portal) throw new Error('the Portal is gone')
    return loadPortalPrintKitContext(
      { publicationRepo: publicationRepo() },
      { organizationId: organizationId(PROPERTY.organizationId), portal },
    )
  }

  it('prints each Portal’s own look: palette, photo and logo', async () => {
    await seedTwoPortals()
    await seedPortalLookOverride(getPool(), scopeOf(SPA), OWN_EVERYTHING_LOOK)
    await publish(RECEPTION)
    await publish(SPA)

    const reception = await printKitOf(RECEPTION)
    const spa = await printKitOf(SPA)

    expect(reception.look).toMatchObject({
      wordmark: 'RILA',
      accentColour: '#1D4ED8',
      fieldColour: '#101820',
      hero: { assetId: SCENARIO_HERO_ASSET },
      logo: { assetId: expect.any(String) },
    })
    expect(spa.look).toMatchObject({
      wordmark: 'SPA',
      propertyName: 'Hotel Rila',
      accentColour: '#B8860B',
      hero: { assetId: SCENARIO_OWN_HERO_ASSET, width: 1200, height: 800 },
      logo: { assetId: SCENARIO_OWN_LOGO_ASSET },
    })
    expect(spa.look.fieldColour).not.toBe(reception.look.fieldColour)
  })

  it('never prints a look that is not published: it prints what is live', async () => {
    await seedTwoPortals()
    await publish(SPA)
    const before = await printKitOf(SPA)

    // Spa takes a look of its own and nobody publishes it.
    await seedPortalLookOverride(getPool(), scopeOf(SPA), OWN_EVERYTHING_LOOK)
    const after = await printKitOf(SPA)

    expect(after).toEqual(before)
    expect(after.look.accentColour).toBe('#1D4ED8')
    expect(after.look.hero?.assetId).toBe(SCENARIO_HERO_ASSET)
  })

  it('has nothing to print for a Portal that was never published, whatever look it has', async () => {
    await seedTwoPortals()
    await seedPortalLookOverride(getPool(), scopeOf(SPA), OWN_EVERYTHING_LOOK)

    await expect(printKitOf(SPA)).rejects.toMatchObject({
      code: 'publication_snapshot_unavailable',
    })
  })
})
