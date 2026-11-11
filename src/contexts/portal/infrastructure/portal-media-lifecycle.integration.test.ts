// Portal context — a stored image through its life, over real PostgreSQL with
// two Organizations: served to a guest (only what is active and intact, nothing
// about the store in the answer), taken down (it stops being served at once and
// its object goes after), and swept (a failed removal is finished, and what
// nothing refers to is collected). The use cases are the real ones over the real
// media repository; only the object store and the execution policy are stood in.

import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { getDb } from '#/shared/db'
import {
  organizationId,
  portalMediaAssetId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  servePortalMedia,
  type ServePortalMediaDeps,
} from '../application/use-cases/serve-portal-media'
import {
  MEDIA_SWEEP_BATCH_SIZE,
  UNREFERENCED_GRACE_MS,
  sweepPortalMedia,
} from '../application/use-cases/sweep-portal-media'
import { takeDownPortalMedia } from '../application/use-cases/take-down-portal-media'
import { isPortalError, type PortalError } from '../domain/errors'
import type { PortalMediaAsset } from '../domain/portal-media-asset'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'
import {
  MEDIA_EXPERIENCE_TABLES,
  seedBrandProfile,
  seedMediaAsset,
  seedMediaProperty,
} from './testing/portal-media-experience-seed'

const ORG = organizationId('org-media-lifecycle-000000000001')
const OTHER_ORG = organizationId('org-media-lifecycle-000000000002')
const NOW = new Date('2026-10-10T12:00:00Z')
const OLD = new Date(NOW.getTime() - UNREFERENCED_GRACE_MS - 60_000)
const RECENT = new Date(NOW.getTime() - UNREFERENCED_GRACE_MS + 60_000)

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: MEDIA_EXPERIENCE_TABLES,
})

const mediaRepo = () => createPortalMediaAssetRepository(getDb())
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

const errorLogger = () => {
  const errors: Array<Record<string, unknown>> = []
  const infos: Array<Record<string, unknown>> = []
  const logger = {
    info: (context: Record<string, unknown>) => infos.push(context),
    error: (context: Record<string, unknown>) => errors.push(context),
  } as unknown as Pick<LoggerPort, 'info' | 'error'>
  return { logger, errors, infos }
}

const readAsset = async (org: OrganizationId, id: string) =>
  mediaRepo().findById(org, portalMediaAssetId(id))

describe('servePortalMedia (real PostgreSQL)', () => {
  const BYTES = Buffer.from('RIFF....WEBPVP8 pretend image bytes')
  const SHA = sha256Hex(BYTES)

  async function setup(
    assetOverrides: Partial<PortalMediaAsset> = {},
    decide: ServePortalMediaDeps['decidePublic'] = async () => ({ allowed: true }),
  ) {
    const property = await seedMediaProperty(getPool(), ORG)
    const asset = await seedMediaAsset(ORG, property, {
      byteSize: BYTES.length,
      contentSha256: SHA,
      ...assetOverrides,
    })
    const objects = createInMemoryObjectStore()
    const { logger, errors } = errorLogger()
    const repo = mediaRepo()
    const decidePublic = vi.fn(decide)
    const serve = servePortalMedia({
      mediaRepo: repo,
      objectStore: objects,
      sha256Hex,
      logger,
      decidePublic,
      clock: () => NOW,
    })
    const store = () => objects.putObject(asset.objectKey, BYTES, 'image/webp')
    return { serve, asset, property, objects, repo, errors, store, decidePublic }
  }

  it('serves the stored bytes as WebP, with an etag of their hash', async () => {
    const { serve, store, asset } = await setup()
    await store()

    expect(await serve({ assetId: asset.id })).toEqual({
      kind: 'found',
      bytes: new Uint8Array(BYTES),
      contentType: 'image/webp',
      etag: `"${SHA}"`,
    })
  })

  it('says the content type from the row, not from what the store reports', async () => {
    const { serve, asset, objects } = await setup()
    await objects.putObject(asset.objectKey, BYTES, 'text/html')

    expect(await serve({ assetId: asset.id })).toMatchObject({
      kind: 'found',
      contentType: 'image/webp',
    })
  })

  it('serves an image to a guest with no tenant, whatever Organization holds it', async () => {
    const tenantB = await seedMediaProperty(getPool(), OTHER_ORG)
    const asset = await seedMediaAsset(OTHER_ORG, tenantB, {
      byteSize: BYTES.length,
      contentSha256: SHA,
    })
    const objects = createInMemoryObjectStore()
    await objects.putObject(asset.objectKey, BYTES, 'image/webp')
    const decidePublic = vi.fn(async () => ({ allowed: true }))

    const result = await servePortalMedia({
      mediaRepo: mediaRepo(),
      objectStore: objects,
      sha256Hex,
      logger: errorLogger().logger,
      decidePublic,
      clock: () => NOW,
    })({ assetId: asset.id })

    expect(result.kind).toBe('found')
    expect(decidePublic).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: OTHER_ORG, propertyId: tenantB }),
    )
  })

  it.each([
    ['not a UUID', 'portal-media/../../etc/passwd'],
    ['an empty id', ''],
    ['an id with a suffix', `${randomUUID()}.webp`],
  ])('does not look anything up for %s', async (_name, assetId) => {
    const { serve, repo, objects } = await setup()
    const find = vi.spyOn(repo, 'findForPublicRead')
    const get = vi.spyOn(objects, 'getObject')

    expect(await serve({ assetId })).toEqual({ kind: 'not_found' })
    expect(find).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('does not know an asset that does not exist', async () => {
    const { serve } = await setup()
    expect(await serve({ assetId: randomUUID() })).toEqual({ kind: 'not_found' })
  })

  it('stops serving a taken-down asset, without touching the store', async () => {
    const { serve, store, repo, asset, objects } = await setup()
    await store()
    await repo.markTakenDown(ORG, asset.id, new Date())
    const get = vi.spyOn(objects, 'getObject')

    expect(await serve({ assetId: asset.id })).toEqual({ kind: 'not_found' })
    expect(get).not.toHaveBeenCalled()
  })

  describe('the execution policy', () => {
    it("asks about the asset's own Organization and Property, as every public Portal read does", async () => {
      const { serve, store, asset, decidePublic } = await setup()
      await store()

      await serve({ assetId: asset.id })

      expect(decidePublic).toHaveBeenCalledExactlyOnceWith({
        action: 'public:portal.read',
        capability: 'portal.public_read',
        organizationId: ORG,
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
        const { serve, store, asset, objects } = await setup({}, async () => ({
          allowed: false,
        }))
        await store()
        const get = vi.spyOn(objects, 'getObject')

        expect(await serve({ assetId: asset.id })).toEqual({ kind: 'not_found' })
        expect(get).not.toHaveBeenCalled()
      },
    )

    it('does not answer not modified when the policy denies', async () => {
      const { serve, store, asset } = await setup({}, async () => ({ allowed: false }))
      await store()
      expect(await serve({ assetId: asset.id, ifNoneMatch: `"${SHA}"` })).toEqual({
        kind: 'not_found',
      })
    })

    it('does not ask the policy about an id that is not an asset', async () => {
      const { serve, decidePublic } = await setup()
      await serve({ assetId: randomUUID() })
      await serve({ assetId: 'nope' })
      expect(decidePublic).not.toHaveBeenCalled()
    })

    it('lets a policy failure through, so the edge can say it is unavailable', async () => {
      const { serve, store, asset } = await setup({}, async () => {
        throw new Error('policy_unavailable')
      })
      await store()
      await expect(serve({ assetId: asset.id })).rejects.toThrow('policy_unavailable')
    })
  })

  describe('revalidation', () => {
    it.each([
      ['the etag', `"${SHA}"`],
      ['a weak form of it', `W/"${SHA}"`],
      ['a list containing it', `"other", "${SHA}"`],
      ['a wildcard', '*'],
    ])('answers not modified for %s, without reading the object', async (_n, header) => {
      const { serve, store, asset, objects } = await setup()
      await store()
      const get = vi.spyOn(objects, 'getObject')

      expect(await serve({ assetId: asset.id, ifNoneMatch: header })).toEqual({
        kind: 'not_modified',
        etag: `"${SHA}"`,
      })
      expect(get).not.toHaveBeenCalled()
    })

    it('serves in full when the etag is for something else', async () => {
      const { serve, store, asset } = await setup()
      await store()
      const result = await serve({ assetId: asset.id, ifNoneMatch: '"stale"' })
      expect(result.kind).toBe('found')
    })

    it('never answers not modified for an asset that is taken down', async () => {
      const { serve, repo, asset } = await setup()
      await repo.markTakenDown(ORG, asset.id, new Date())
      expect(await serve({ assetId: asset.id, ifNoneMatch: `"${SHA}"` })).toEqual({
        kind: 'not_found',
      })
    })
  })

  describe('an object that is not what the row says', () => {
    it('reports a missing object and serves nothing', async () => {
      const { serve, asset, errors } = await setup()
      expect(await serve({ assetId: asset.id })).toEqual({ kind: 'not_found' })
      expect(errors).toEqual([
        { assetId: asset.id, errorCode: 'portal_media_object_missing' },
      ])
    })

    it('reports bytes of the wrong hash and serves nothing', async () => {
      const { serve, asset, objects, errors } = await setup()
      await objects.putObject(
        asset.objectKey,
        Buffer.alloc(BYTES.length, 7),
        'image/webp',
      )
      expect(await serve({ assetId: asset.id })).toEqual({ kind: 'not_found' })
      expect(errors).toEqual([
        { assetId: asset.id, errorCode: 'portal_media_object_mismatch' },
      ])
    })

    it('treats an object larger than the row says as a mismatch: a 404, logged, not a store failure', async () => {
      const { serve, asset, objects, errors } = await setup()
      await objects.putObject(
        asset.objectKey,
        Buffer.concat([BYTES, BYTES]),
        'image/webp',
      )
      expect(await serve({ assetId: asset.id })).toEqual({ kind: 'not_found' })
      expect(errors).toEqual([
        { assetId: asset.id, errorCode: 'portal_media_object_mismatch' },
      ])
    })
  })

  it('lets a store failure through, so the edge can say it is unavailable', async () => {
    const { serve, asset, objects } = await setup()
    objects.failNextGet(new Error('socket hang up'))
    await expect(serve({ assetId: asset.id })).rejects.toThrow('socket hang up')
  })

  it('reads at most the size the row records', async () => {
    const { serve, store, asset, objects } = await setup()
    await store()
    const get = vi.spyOn(objects, 'getObject')
    await serve({ assetId: asset.id })
    expect(get).toHaveBeenCalledExactlyOnceWith(
      `portal-media/${asset.id}.webp`,
      BYTES.length,
    )
  })
})

describe('takeDownPortalMedia (real PostgreSQL)', () => {
  const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
    getAccessiblePropertyIds: async () => accessible,
    getAssignedPortals: async () => [],
  })
  const admin = (org: OrganizationId = ORG) =>
    buildTestAuthContext({ role: 'AccountAdmin', organizationId: org })

  async function setup(accessible: ReadonlyArray<PropertyId> | null = null) {
    const property = await seedMediaProperty(getPool(), ORG)
    const asset = await seedMediaAsset(ORG, property)
    const objects = createInMemoryObjectStore()
    const { logger, infos, errors } = errorLogger()
    const deps = {
      mediaRepo: mediaRepo(),
      objectStore: objects,
      staffPublicApi: staffApi(accessible),
      clock: () => NOW,
      logger,
    }
    const store = () => objects.putObject(asset.objectKey, Buffer.from('x'), 'image/webp')
    return {
      takeDown: takeDownPortalMedia(deps),
      deps,
      objects,
      asset,
      infos,
      errors,
      store,
    }
  }

  const failure = async (promise: Promise<unknown>): Promise<PortalError> => {
    try {
      await promise
    } catch (error) {
      if (isPortalError(error)) return error
      throw error
    }
    throw new Error('expected the takedown to fail')
  }

  it('stops the asset being served and removes its object', async () => {
    const { takeDown, objects, asset, store } = await setup()
    await store()

    const result = await takeDown({ assetId: asset.id }, admin())

    expect(result).toEqual({ assetId: asset.id, objectRemoved: true })
    expect(await readAsset(ORG, asset.id)).toMatchObject({
      status: 'taken_down',
      takenDownAt: NOW,
      objectDeletedAt: NOW,
    })
    expect(objects.objects().has(asset.objectKey)).toBe(false)
  })

  it('records who did it, as identifiers only', async () => {
    const { takeDown, asset, infos } = await setup()
    const ctx = admin()
    await takeDown({ assetId: asset.id }, ctx)
    expect(infos).toEqual([{ assetId: asset.id, actorUserId: ctx.userId }])
  })

  it('still takes the asset down when the object cannot be removed, and says it is pending', async () => {
    const { takeDown, objects, asset, store, errors } = await setup()
    await store()
    objects.failNextDelete(new Error('store unavailable'))

    const result = await takeDown({ assetId: asset.id }, admin())

    expect(result).toEqual({ assetId: asset.id, objectRemoved: false })
    expect(await readAsset(ORG, asset.id)).toMatchObject({
      status: 'taken_down',
      objectDeletedAt: null,
    })
    expect(objects.objects().has(asset.objectKey)).toBe(true)
    expect(errors).toEqual([
      { assetId: asset.id, errorCode: 'portal_media_takedown_object_pending' },
    ])
  })

  it('is safe to repeat, and finishes an object removal that failed the first time', async () => {
    const { takeDown, objects, asset, store } = await setup()
    await store()
    objects.failNextDelete(new Error('store unavailable'))
    await takeDown({ assetId: asset.id }, admin())

    const again = await takeDown({ assetId: asset.id }, admin())

    expect(again).toEqual({ assetId: asset.id, objectRemoved: true })
    expect((await readAsset(ORG, asset.id))?.objectDeletedAt).toEqual(NOW)
    expect(objects.objects().has(asset.objectKey)).toBe(false)
    expect(await takeDown({ assetId: asset.id }, admin())).toEqual({
      assetId: asset.id,
      objectRemoved: true,
    })
  })

  it('keeps the first takedown time when repeated', async () => {
    const { takeDown, asset, store } = await setup()
    await store()
    await takeDown({ assetId: asset.id }, admin())
    await takeDown({ assetId: asset.id }, admin())
    expect((await readAsset(ORG, asset.id))?.takenDownAt).toEqual(NOW)
  })

  it('reports success when a concurrent takedown got there between the read and the update', async () => {
    const { deps, objects, asset, store } = await setup()
    await store()
    const real = mediaRepo()
    // The first reader saw it active; by the time it updates, the other request
    // has taken it down, so its own conditional update changes nothing.
    const racing = {
      ...real,
      findById: async (...args: Parameters<typeof real.findById>) => {
        const seen = await real.findById(...args)
        await real.markTakenDown(ORG, asset.id, NOW)
        return seen
      },
    }

    const result = await takeDownPortalMedia({ ...deps, mediaRepo: racing })(
      { assetId: asset.id },
      admin(),
    )

    expect(result).toEqual({ assetId: asset.id, objectRemoved: true })
    expect(objects.objects().has(asset.objectKey)).toBe(false)
  })

  describe('who may take an image down', () => {
    it('refuses everyone but an Account Admin', async () => {
      const { takeDown, asset } = await setup()
      for (const role of ['PropertyManager', 'Member'] as const) {
        const error = await failure(
          takeDown(
            { assetId: asset.id },
            buildTestAuthContext({ role, organizationId: ORG }),
          ),
        )
        expect(error.code).toBe('forbidden')
      }
      expect((await readAsset(ORG, asset.id))?.status).toBe('active')
    })

    it('does not find an asset of another Organization', async () => {
      const { takeDown, asset } = await setup()

      const error = await failure(takeDown({ assetId: asset.id }, admin(OTHER_ORG)))

      expect(error.code).toBe('media_not_found')
      expect((await readAsset(ORG, asset.id))?.status).toBe('active')
    })

    it('does not find an asset that does not exist', async () => {
      const { takeDown } = await setup()
      const error = await failure(takeDown({ assetId: randomUUID() }, admin()))
      expect(error.code).toBe('media_not_found')
    })
  })
})

describe('sweepPortalMedia (real PostgreSQL)', () => {
  async function setup() {
    const property = await seedMediaProperty(getPool(), ORG)
    const objects = createInMemoryObjectStore()
    const { logger, errors } = errorLogger()
    const repo = mediaRepo()
    const sweep = sweepPortalMedia({
      mediaRepo: repo,
      objectStore: objects,
      clock: () => NOW,
      logger,
    })
    const add = async (overrides: Partial<PortalMediaAsset> = {}) => {
      const asset = await seedMediaAsset(ORG, property, { createdAt: OLD, ...overrides })
      await objects.putObject(asset.objectKey, Buffer.from('x'), 'image/webp')
      return asset
    }
    /** What a Brand Profile that shows the image does: it refers to it. */
    const refer = (asset: PortalMediaAsset) =>
      seedBrandProfile(getPool(), ORG, property, {
        heroAssetId: asset.id,
        heroFocalX: 0.5,
        heroFocalY: 0.5,
      })
    return { sweep, repo, objects, errors, add, refer }
  }

  it('does nothing when there is nothing to do', async () => {
    const { sweep } = await setup()
    expect(await sweep()).toEqual({ takenDownObjectsRemoved: 0, discarded: 0, failed: 0 })
  })

  describe('objects of taken-down assets', () => {
    it('removes the object and records it', async () => {
      const { sweep, repo, objects, add } = await setup()
      const asset = await add()
      await repo.markTakenDown(ORG, asset.id, OLD)

      expect(await sweep()).toMatchObject({ takenDownObjectsRemoved: 1, failed: 0 })

      expect(objects.objects().has(asset.objectKey)).toBe(false)
      expect(await readAsset(ORG, asset.id)).toMatchObject({
        status: 'taken_down',
        objectDeletedAt: NOW,
      })
    })

    it('leaves it for the next run when the store fails, and carries on with the others', async () => {
      const { sweep, repo, objects, add, errors } = await setup()
      const first = await add()
      const second = await add()
      await repo.markTakenDown(ORG, first.id, OLD)
      await repo.markTakenDown(ORG, second.id, NOW)
      objects.failNextDelete(new Error('store unavailable'))

      expect(await sweep()).toMatchObject({ takenDownObjectsRemoved: 1, failed: 1 })
      expect((await readAsset(ORG, first.id))?.objectDeletedAt).toBeNull()
      expect((await readAsset(ORG, second.id))?.objectDeletedAt).toEqual(NOW)
      expect(errors).toEqual([
        { assetId: first.id, errorCode: 'portal_media_sweep_object_failed' },
      ])

      expect(await sweep()).toMatchObject({ takenDownObjectsRemoved: 1, failed: 0 })
      expect(objects.objects().has(first.objectKey)).toBe(false)
    })

    it('does not touch the object of an asset that is still active', async () => {
      const { sweep, objects, add, refer } = await setup()
      const asset = await add({ createdAt: RECENT })
      await refer(asset)
      await sweep()
      expect(objects.objects().has(asset.objectKey)).toBe(true)
    })
  })

  describe('images nothing refers to', () => {
    it('collects an old, unreferenced image: object and row', async () => {
      const { sweep, objects, add } = await setup()
      const lonely = await add()

      expect(await sweep()).toMatchObject({ discarded: 1, failed: 0 })

      expect(objects.objects().has(lonely.objectKey)).toBe(false)
      expect(await readAsset(ORG, lonely.id)).toBeNull()
    })

    it('keeps an image something still refers to, however old', async () => {
      const { sweep, objects, add, refer } = await setup()
      const used = await add({ createdAt: new Date('2020-01-01T00:00:00Z') })
      await refer(used)

      expect(await sweep()).toMatchObject({ discarded: 0 })
      expect(objects.objects().has(used.objectKey)).toBe(true)
      expect(await readAsset(ORG, used.id)).not.toBeNull()
    })

    it('keeps an image still inside the grace period, so an upload being attached is safe', async () => {
      const { sweep, objects, add } = await setup()
      const fresh = await add({ createdAt: RECENT })

      expect(await sweep()).toMatchObject({ discarded: 0 })
      expect(objects.objects().has(fresh.objectKey)).toBe(true)
      expect(await readAsset(ORG, fresh.id)).not.toBeNull()
    })

    it('keeps the row when the object could not be removed, and counts the failure', async () => {
      const { sweep, objects, add, errors } = await setup()
      const lonely = await add()
      objects.failNextDelete(new Error('store unavailable'))

      expect(await sweep()).toMatchObject({ discarded: 0, failed: 1 })
      expect(await readAsset(ORG, lonely.id)).not.toBeNull()
      expect(errors).toEqual([
        { assetId: lonely.id, errorCode: 'portal_media_sweep_object_failed' },
      ])

      expect(await sweep()).toMatchObject({ discarded: 1, failed: 0 })
      expect(await readAsset(ORG, lonely.id)).toBeNull()
    })

    it('does not collect a taken-down image: its row stays for the snapshots that name it', async () => {
      const { sweep, repo, add } = await setup()
      const down = await add()
      await repo.markTakenDown(ORG, down.id, OLD)
      await sweep()
      expect(await readAsset(ORG, down.id)).toMatchObject({ status: 'taken_down' })
    })
  })

  it('works through at most one batch of each kind per run', async () => {
    const { sweep, add } = await setup()
    await Promise.all(Array.from({ length: MEDIA_SWEEP_BATCH_SIZE + 5 }, () => add()))
    expect(await sweep()).toMatchObject({ discarded: MEDIA_SWEEP_BATCH_SIZE })
    expect(await sweep()).toMatchObject({ discarded: 5 })
  })
})
