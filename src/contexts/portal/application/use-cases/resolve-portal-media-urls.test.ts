// Portal context — which images a published page may show right now.

import { describe, expect, it } from 'vitest'
import { organizationId, portalMediaAssetId, propertyId } from '#/shared/domain/ids'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { resolvePortalMediaUrls } from './resolve-portal-media-urls'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')

describe('resolvePortalMediaUrls', () => {
  it('maps each servable asset to a same-origin URL and leaves the rest out', async () => {
    const mediaRepo = createInMemoryPortalMediaAssetRepo()
    const live = buildTestPortalMediaAsset({ organizationId: ORG, propertyId: PROPERTY })
    const down = buildTestPortalMediaAsset({ organizationId: ORG, propertyId: PROPERTY })
    const foreign = buildTestPortalMediaAsset({
      organizationId: ORG,
      propertyId: OTHER_PROPERTY,
    })
    mediaRepo.seed([live, down, foreign])
    await mediaRepo.markTakenDown(ORG, down.id, new Date())

    const urls = await resolvePortalMediaUrls({ mediaRepo })(ORG, PROPERTY, [
      live.id,
      down.id,
      foreign.id,
      '30000000-0000-4000-8000-0000000000ff',
    ])

    expect(urls).toEqual({ [live.id]: `/api/public/portal-media/${live.id}` })
  })

  it('does not ask the repository about ids that are not UUIDs', async () => {
    const mediaRepo = createInMemoryPortalMediaAssetRepo()
    const asked: unknown[] = []
    const urls = await resolvePortalMediaUrls({
      mediaRepo: {
        listServableIds: async (_org, _property, ids) => {
          asked.push(ids)
          return []
        },
      },
    })(ORG, PROPERTY, ['not-a-uuid', "'; DROP TABLE portal_media_assets; --"])
    expect(urls).toEqual({})
    expect(asked).toEqual([])
    expect(mediaRepo.all()).toEqual([])
    expect(portalMediaAssetId('x')).toBe('x')
  })
})
