// Portal context — which images a page may show right now, over real PostgreSQL
// and two Organizations: the Property look's photograph and logo as a reader
// shows them (right purpose, this Property, still servable, on the app's own
// origin), and the servable ids a published page may draw.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId, portalMediaAssetId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { resolvePortalMediaUrls } from '../application/resolve-portal-media-urls'
import { resolvePropertyLookMedia } from '../application/property-look-media'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'
import {
  MEDIA_EXPERIENCE_TABLES,
  seedMediaAsset,
  seedMediaProperty,
} from './testing/portal-media-experience-seed'

const ORG_A = organizationId('org-media-resolution-000000000001')
const ORG_B = organizationId('org-media-resolution-000000000002')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: MEDIA_EXPERIENCE_TABLES,
})

const mediaRepo = () => createPortalMediaAssetRepository(getDb())
const mediaPath = (id: string) => `/api/public/portal-media/${id}`

async function scene() {
  const property = await seedMediaProperty(getPool(), ORG_A)
  const otherProperty = await seedMediaProperty(getPool(), ORG_A)
  const hero = await seedMediaAsset(ORG_A, property, {
    purpose: 'hero',
    width: 2400,
    height: 1600,
  })
  const logo = await seedMediaAsset(ORG_A, property, {
    purpose: 'logo',
    width: 480,
    height: 120,
  })
  return { property, otherProperty, hero, logo }
}

const profileOf = (heroId: string | null, logoId: string | null) => ({
  heroAssetId: heroId,
  heroFocalX: heroId === null ? null : 0.5,
  heroFocalY: heroId === null ? null : 0.42,
  logoAssetId: logoId,
})

describe('resolvePropertyLookMedia (real PostgreSQL)', () => {
  it('gives the photograph its size and focal point and the logo its size, both on the media route', async () => {
    const { property, hero, logo } = await scene()

    const media = await resolvePropertyLookMedia(
      { mediaRepo: mediaRepo() },
      ORG_A,
      property,
      profileOf(hero.id, logo.id),
    )

    expect(media).toEqual({
      hero: {
        assetId: hero.id,
        url: mediaPath(hero.id),
        width: 2400,
        height: 1600,
        focalX: 0.5,
        focalY: 0.42,
      },
      logo: { assetId: logo.id, url: mediaPath(logo.id), width: 480, height: 120 },
    })
  })

  it('has nothing for a profile that names no media, or for no profile', async () => {
    const { property } = await scene()
    const resolve = (profile: ReturnType<typeof profileOf> | null) =>
      resolvePropertyLookMedia({ mediaRepo: mediaRepo() }, ORG_A, property, profile)

    expect(await resolve(profileOf(null, null))).toEqual({ hero: null, logo: null })
    expect(await resolve(null)).toEqual({ hero: null, logo: null })
  })

  it('leaves out an image that was taken down, so the look reads as having none', async () => {
    const { property, hero, logo } = await scene()
    await mediaRepo().markTakenDown(ORG_A, hero.id, new Date())

    const media = await resolvePropertyLookMedia(
      { mediaRepo: mediaRepo() },
      ORG_A,
      property,
      profileOf(hero.id, logo.id),
    )

    expect(media.hero).toBeNull()
    expect(media.logo).not.toBeNull()
  })

  it('leaves out an image of another Property, of another purpose, of another Organization or that is missing', async () => {
    const { property, otherProperty, logo } = await scene()
    const foreignHero = await seedMediaAsset(ORG_A, otherProperty, { purpose: 'hero' })
    const tilePicture = await seedMediaAsset(ORG_A, property, { purpose: 'link_image' })
    const tenantB = await seedMediaProperty(getPool(), ORG_B)
    const otherTenantHero = await seedMediaAsset(ORG_B, tenantB, { purpose: 'hero' })
    const resolve = (heroId: string, logoId: string | null = logo.id) =>
      resolvePropertyLookMedia(
        { mediaRepo: mediaRepo() },
        ORG_A,
        property,
        profileOf(heroId, logoId),
      )

    expect((await resolve(foreignHero.id)).hero).toBeNull()
    expect((await resolve(tilePicture.id)).hero).toBeNull()
    expect((await resolve(otherTenantHero.id)).hero).toBeNull()
    expect((await resolve(randomUUID(), randomUUID())).logo).toBeNull()
  })

  it('does not draw a photograph that has no focal point', async () => {
    const { property, hero, logo } = await scene()

    const media = await resolvePropertyLookMedia(
      { mediaRepo: mediaRepo() },
      ORG_A,
      property,
      { ...profileOf(hero.id, logo.id), heroFocalX: null, heroFocalY: null },
    )

    expect(media.hero).toBeNull()
  })
})

describe('resolvePortalMediaUrls (real PostgreSQL)', () => {
  it('maps each servable asset to a same-origin URL and leaves the rest out', async () => {
    const { property, otherProperty } = await scene()
    const live = await seedMediaAsset(ORG_A, property)
    const down = await seedMediaAsset(ORG_A, property)
    const foreign = await seedMediaAsset(ORG_A, otherProperty)
    const tenantB = await seedMediaProperty(getPool(), ORG_B)
    const otherTenant = await seedMediaAsset(ORG_B, tenantB)
    await mediaRepo().markTakenDown(ORG_A, down.id, new Date())

    const urls = await resolvePortalMediaUrls({ mediaRepo: mediaRepo() })(
      ORG_A,
      property,
      [live.id, down.id, foreign.id, otherTenant.id, randomUUID()],
    )

    expect(urls).toEqual({ [live.id]: mediaPath(live.id) })
  })

  it('does not ask the repository about ids that are not UUIDs', async () => {
    const { property } = await scene()
    const repo = mediaRepo()
    const asked = vi.spyOn(repo, 'listServableIds')

    const urls = await resolvePortalMediaUrls({ mediaRepo: repo })(ORG_A, property, [
      'not-a-uuid',
      "'; DROP TABLE portal_media_assets; --",
    ])

    expect(urls).toEqual({})
    expect(asked).not.toHaveBeenCalled()
    expect(portalMediaAssetId('x')).toBe('x')
  })
})
