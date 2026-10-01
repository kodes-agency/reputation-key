// Portal context — taking an image down: it stops being served at once, and its
// object is removed after; a failed removal is retried by the sweep.

import { describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  organizationId,
  portalMediaAssetId,
  propertyId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { isPortalError, type PortalError } from '../../domain/errors'
import { takeDownPortalMedia } from './take-down-portal-media'

const NOW = new Date('2026-10-01T12:00:00Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const ASSET_ID = '30000000-0000-4000-8000-000000000001'

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const objects = createInMemoryObjectStore()
  const infos: Array<Record<string, unknown>> = []
  const errors: Array<Record<string, unknown>> = []
  const logger = {
    info: (context: Record<string, unknown>) => infos.push(context),
    error: (context: Record<string, unknown>) => errors.push(context),
  } as unknown as Pick<LoggerPort, 'info' | 'error'>
  const asset = buildTestPortalMediaAsset({
    id: portalMediaAssetId(ASSET_ID),
    organizationId: ORG,
    propertyId: PROPERTY,
  })
  mediaRepo.seed([asset])
  const takeDown = takeDownPortalMedia({
    mediaRepo,
    objectStore: objects,
    staffPublicApi: staffApi(accessible),
    clock: () => NOW,
    logger,
  })
  const store = () => objects.putObject(asset.objectKey, Buffer.from('x'), 'image/webp')
  return { takeDown, mediaRepo, objects, asset, infos, errors, store }
}

const admin = () => buildTestAuthContext({ role: 'AccountAdmin' })
const manager = () => buildTestAuthContext({ role: 'PropertyManager' })

const failure = async (promise: Promise<unknown>): Promise<PortalError> => {
  try {
    await promise
  } catch (error) {
    if (isPortalError(error)) return error
    throw error
  }
  throw new Error('expected the takedown to fail')
}

describe('takeDownPortalMedia', () => {
  it('stops the asset being served and removes its object', async () => {
    const { takeDown, mediaRepo, objects, asset, store } = setup()
    await store()

    const result = await takeDown({ assetId: ASSET_ID }, admin())

    expect(result).toEqual({ assetId: ASSET_ID, objectRemoved: true })
    expect(await mediaRepo.findById(ORG, asset.id)).toMatchObject({
      status: 'taken_down',
      takenDownAt: NOW,
      objectDeletedAt: NOW,
    })
    expect(objects.objects().has(asset.objectKey)).toBe(false)
  })

  it('records who did it, as identifiers only', async () => {
    const { takeDown, infos } = setup()
    const ctx = admin()
    await takeDown({ assetId: ASSET_ID }, ctx)
    expect(infos).toEqual([{ assetId: ASSET_ID, actorUserId: ctx.userId }])
  })

  it('still takes the asset down when the object cannot be removed, and says it is pending', async () => {
    const { takeDown, mediaRepo, objects, asset, store, errors } = setup()
    await store()
    objects.failNextDelete(new Error('store unavailable'))

    const result = await takeDown({ assetId: ASSET_ID }, admin())

    expect(result).toEqual({ assetId: ASSET_ID, objectRemoved: false })
    expect(await mediaRepo.findById(ORG, asset.id)).toMatchObject({
      status: 'taken_down',
      objectDeletedAt: null,
    })
    expect(objects.objects().has(asset.objectKey)).toBe(true)
    expect(errors).toEqual([
      { assetId: ASSET_ID, errorCode: 'portal_media_takedown_object_pending' },
    ])
  })

  it('is safe to repeat, and finishes an object removal that failed the first time', async () => {
    const { takeDown, mediaRepo, objects, asset, store } = setup()
    await store()
    objects.failNextDelete(new Error('store unavailable'))
    await takeDown({ assetId: ASSET_ID }, admin())

    const again = await takeDown({ assetId: ASSET_ID }, admin())

    expect(again).toEqual({ assetId: ASSET_ID, objectRemoved: true })
    expect((await mediaRepo.findById(ORG, asset.id))?.objectDeletedAt).toEqual(NOW)
    expect(objects.objects().has(asset.objectKey)).toBe(false)
    expect(await takeDown({ assetId: ASSET_ID }, admin())).toEqual({
      assetId: ASSET_ID,
      objectRemoved: true,
    })
  })

  it('keeps the first takedown time when repeated', async () => {
    const { takeDown, mediaRepo, asset, store } = setup()
    await store()
    await takeDown({ assetId: ASSET_ID }, admin())
    await takeDown({ assetId: ASSET_ID }, admin())
    expect((await mediaRepo.findById(ORG, asset.id))?.takenDownAt).toEqual(NOW)
  })

  it('reports success when a concurrent takedown got there between the read and the update', async () => {
    const { mediaRepo, objects, asset, store, infos, errors } = setup()
    await store()
    // The first reader saw it active; by the time it updates, the other request
    // has taken it down, so its own conditional update changes nothing.
    const racing = {
      ...mediaRepo,
      findById: async (...args: Parameters<typeof mediaRepo.findById>) => {
        const seen = await mediaRepo.findById(...args)
        await mediaRepo.markTakenDown(ORG, asset.id, NOW)
        return seen
      },
    }
    const takeDown = takeDownPortalMedia({
      mediaRepo: racing,
      objectStore: objects,
      staffPublicApi: staffApi(null),
      clock: () => NOW,
      logger: {
        info: (context: Record<string, unknown>) => infos.push(context),
        error: (context: Record<string, unknown>) => errors.push(context),
      } as unknown as Pick<LoggerPort, 'info' | 'error'>,
    })

    expect(await takeDown({ assetId: ASSET_ID }, admin())).toEqual({
      assetId: ASSET_ID,
      objectRemoved: true,
    })
    expect(objects.objects().has(asset.objectKey)).toBe(false)
  })

  describe('who may take an image down', () => {
    it('refuses everyone but an Account Admin', async () => {
      const { takeDown, mediaRepo, asset } = setup()
      for (const ctx of [manager(), buildTestAuthContext({ role: 'Member' })]) {
        expect((await failure(takeDown({ assetId: ASSET_ID }, ctx))).code).toBe(
          'forbidden',
        )
      }
      expect((await mediaRepo.findById(ORG, asset.id))?.status).toBe('active')
    })

    it('does not find an asset of another Organization', async () => {
      const { takeDown, mediaRepo, asset } = setup()
      const outsider = buildTestAuthContext({
        role: 'AccountAdmin',
        organizationId: organizationId('org-99999999-0000-0000-0000-000000000009'),
      })
      expect((await failure(takeDown({ assetId: ASSET_ID }, outsider))).code).toBe(
        'media_not_found',
      )
      expect((await mediaRepo.findById(ORG, asset.id))?.status).toBe('active')
    })

    it('does not find an asset that does not exist', async () => {
      const { takeDown } = setup()
      expect(
        (
          await failure(
            takeDown({ assetId: '30000000-0000-4000-8000-0000000000ff' }, admin()),
          )
        ).code,
      ).toBe('media_not_found')
    })
  })
})
