// Portal context — serving a stored image to a guest: only what is active, only
// what is intact, and nothing about the store reaches the answer.

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { servePortalMedia, type ServePortalMediaDeps } from './serve-portal-media'

const BYTES = Buffer.from('RIFF....WEBPVP8 pretend image bytes')
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const SHA = sha256Hex(BYTES)
const ASSET_ID = '30000000-0000-4000-8000-000000000001'

const NOW = new Date('2026-10-01T10:00:00.000Z')

const setup = (
  assetOverrides: Parameters<typeof buildTestPortalMediaAsset>[0] = {},
  decide: ServePortalMediaDeps['decidePublic'] = async () => ({ allowed: true }),
) => {
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const objects = createInMemoryObjectStore()
  const errors: Array<Record<string, unknown>> = []
  const logger = {
    error: (context: Record<string, unknown>) => errors.push(context),
  } as unknown as Pick<LoggerPort, 'error'>
  const asset = buildTestPortalMediaAsset({
    id: portalMediaAssetId(ASSET_ID),
    byteSize: BYTES.length,
    contentSha256: SHA,
    ...assetOverrides,
  })
  mediaRepo.seed([asset])
  const decidePublic = vi.fn(decide)
  const serve = servePortalMedia({
    mediaRepo,
    objectStore: objects,
    sha256Hex,
    logger,
    decidePublic,
    clock: () => NOW,
  })
  const store = () => objects.putObject(asset.objectKey, BYTES, 'image/webp')
  return { serve, asset, objects, mediaRepo, errors, store, decidePublic }
}

describe('servePortalMedia', () => {
  it('serves the stored bytes as WebP, with an etag of their hash', async () => {
    const { serve, store } = setup()
    await store()

    const result = await serve({ assetId: ASSET_ID })

    expect(result).toEqual({
      kind: 'found',
      bytes: new Uint8Array(BYTES),
      contentType: 'image/webp',
      etag: `"${SHA}"`,
    })
  })

  it('says the content type from the row, not from what the store reports', async () => {
    const { serve, asset, objects } = setup()
    await objects.putObject(asset.objectKey, BYTES, 'text/html')
    const result = await serve({ assetId: ASSET_ID })
    expect(result).toMatchObject({ kind: 'found', contentType: 'image/webp' })
  })

  it.each([
    ['not a UUID', 'portal-media/../../etc/passwd'],
    ['an empty id', ''],
    ['an id with a suffix', `${ASSET_ID}.webp`],
  ])('does not look anything up for %s', async (_name, assetId) => {
    const { serve, mediaRepo, objects } = setup()
    const find = vi.spyOn(mediaRepo, 'findForPublicRead')
    const get = vi.spyOn(objects, 'getObject')

    expect(await serve({ assetId })).toEqual({ kind: 'not_found' })
    expect(find).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('does not know an asset that does not exist', async () => {
    const { serve } = setup()
    expect(await serve({ assetId: '30000000-0000-4000-8000-0000000000ff' })).toEqual({
      kind: 'not_found',
    })
  })

  it('stops serving a taken-down asset, without touching the store', async () => {
    const { serve, store, mediaRepo, asset, objects } = setup()
    await store()
    await mediaRepo.markTakenDown(asset.organizationId, asset.id, new Date())
    const get = vi.spyOn(objects, 'getObject')

    expect(await serve({ assetId: ASSET_ID })).toEqual({ kind: 'not_found' })
    expect(get).not.toHaveBeenCalled()
  })

  describe('the execution policy', () => {
    it("asks about the asset's own Organization and Property, as every public Portal read does", async () => {
      const { serve, store, asset, decidePublic } = setup()
      await store()

      await serve({ assetId: ASSET_ID })

      expect(decidePublic).toHaveBeenCalledExactlyOnceWith({
        action: 'public:portal.read',
        capability: 'portal.public_read',
        organizationId: asset.organizationId,
        propertyId: asset.propertyId,
        now: NOW,
      })
    })

    // The policy owns the reason (kill switch, suspended Organization or Property,
    // allowlist); this use case only has to honour a denial of any kind.
    it.each([
      ['the portal.public_read kill switch'],
      ['a suspended Organization'],
      ['a suspended Property'],
    ])(
      'gives the same 404 as a missing image under %s, without reading the store',
      async () => {
        const { serve, store, objects } = setup({}, async () => ({ allowed: false }))
        await store()
        const get = vi.spyOn(objects, 'getObject')

        expect(await serve({ assetId: ASSET_ID })).toEqual({ kind: 'not_found' })
        expect(get).not.toHaveBeenCalled()
      },
    )

    it('does not answer not modified when the policy denies', async () => {
      const { serve, store } = setup({}, async () => ({ allowed: false }))
      await store()
      expect(await serve({ assetId: ASSET_ID, ifNoneMatch: `"${SHA}"` })).toEqual({
        kind: 'not_found',
      })
    })

    it('does not ask the policy about an id that is not an asset', async () => {
      const { serve, decidePublic } = setup()
      await serve({ assetId: '30000000-0000-4000-8000-0000000000ff' })
      await serve({ assetId: 'nope' })
      expect(decidePublic).not.toHaveBeenCalled()
    })

    it('lets a policy failure through, so the edge can say it is unavailable', async () => {
      const { serve, store } = setup({}, async () => {
        throw new Error('policy_unavailable')
      })
      await store()
      await expect(serve({ assetId: ASSET_ID })).rejects.toThrow('policy_unavailable')
    })
  })

  describe('revalidation', () => {
    it.each([
      ['the etag', `"${SHA}"`],
      ['a weak form of it', `W/"${SHA}"`],
      ['a list containing it', `"other", "${SHA}"`],
      ['a wildcard', '*'],
    ])('answers not modified for %s, without reading the object', async (_n, header) => {
      const { serve, store, objects } = setup()
      await store()
      const get = vi.spyOn(objects, 'getObject')

      expect(await serve({ assetId: ASSET_ID, ifNoneMatch: header })).toEqual({
        kind: 'not_modified',
        etag: `"${SHA}"`,
      })
      expect(get).not.toHaveBeenCalled()
    })

    it('serves in full when the etag is for something else', async () => {
      const { serve, store } = setup()
      await store()
      const result = await serve({ assetId: ASSET_ID, ifNoneMatch: '"stale"' })
      expect(result.kind).toBe('found')
    })

    it('never answers not modified for an asset that is taken down', async () => {
      const { serve, mediaRepo, asset } = setup()
      await mediaRepo.markTakenDown(asset.organizationId, asset.id, new Date())
      expect(await serve({ assetId: ASSET_ID, ifNoneMatch: `"${SHA}"` })).toEqual({
        kind: 'not_found',
      })
    })
  })

  describe('an object that is not what the row says', () => {
    it('reports a missing object and serves nothing', async () => {
      const { serve, errors } = setup()
      expect(await serve({ assetId: ASSET_ID })).toEqual({ kind: 'not_found' })
      expect(errors).toEqual([
        { assetId: ASSET_ID, errorCode: 'portal_media_object_missing' },
      ])
    })

    it('reports bytes of the wrong hash and serves nothing', async () => {
      const { serve, asset, objects, errors } = setup()
      await objects.putObject(
        asset.objectKey,
        Buffer.alloc(BYTES.length, 7),
        'image/webp',
      )
      expect(await serve({ assetId: ASSET_ID })).toEqual({ kind: 'not_found' })
      expect(errors).toEqual([
        { assetId: ASSET_ID, errorCode: 'portal_media_object_mismatch' },
      ])
    })

    it('treats an object larger than the row says as a mismatch: a 404, logged, not a store failure', async () => {
      const { serve, asset, objects, errors } = setup()
      await objects.putObject(
        asset.objectKey,
        Buffer.concat([BYTES, BYTES]),
        'image/webp',
      )
      expect(await serve({ assetId: ASSET_ID })).toEqual({ kind: 'not_found' })
      expect(errors).toEqual([
        { assetId: ASSET_ID, errorCode: 'portal_media_object_mismatch' },
      ])
    })
  })

  it('lets a store failure through, so the edge can say it is unavailable', async () => {
    const { serve, objects } = setup()
    objects.failNextGet(new Error('socket hang up'))
    await expect(serve({ assetId: ASSET_ID })).rejects.toThrow('socket hang up')
  })

  it('reads at most the size the row records', async () => {
    const { serve, store, objects } = setup()
    await store()
    const get = vi.spyOn(objects, 'getObject')
    await serve({ assetId: ASSET_ID })
    expect(get).toHaveBeenCalledExactlyOnceWith(
      `portal-media/${ASSET_ID}.webp`,
      BYTES.length,
    )
  })
})
