// Portal context — the media sweep: it finishes removals a takedown could not,
// and collects images nothing refers to. It never touches an image something
// still needs, and never leaves a row whose object it failed to remove.

import { describe, expect, it } from 'vitest'
import { organizationId, portalMediaAssetId, propertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import {
  MEDIA_SWEEP_BATCH_SIZE,
  UNREFERENCED_GRACE_MS,
  sweepPortalMedia,
} from './sweep-portal-media'

const NOW = new Date('2026-10-10T12:00:00Z')
const OLD = new Date(NOW.getTime() - UNREFERENCED_GRACE_MS - 60_000)
const RECENT = new Date(NOW.getTime() - UNREFERENCED_GRACE_MS + 60_000)
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')

const setup = () => {
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const objects = createInMemoryObjectStore()
  const errors: Array<Record<string, unknown>> = []
  const logger = {
    error: (context: Record<string, unknown>) => errors.push(context),
  } as unknown as Pick<LoggerPort, 'error'>
  const sweep = sweepPortalMedia({
    mediaRepo,
    objectStore: objects,
    clock: () => NOW,
    logger,
  })
  let n = 0
  const add = async (overrides: Parameters<typeof buildTestPortalMediaAsset>[0] = {}) => {
    n += 1
    const asset = buildTestPortalMediaAsset({
      id: portalMediaAssetId(`30000000-0000-4000-8000-${String(n).padStart(12, '0')}`),
      organizationId: ORG,
      propertyId: PROPERTY,
      createdAt: OLD,
      ...overrides,
    })
    mediaRepo.seed([asset])
    await objects.putObject(asset.objectKey, Buffer.from('x'), 'image/webp')
    return asset
  }
  return { sweep, mediaRepo, objects, errors, add }
}

describe('sweepPortalMedia', () => {
  it('does nothing when there is nothing to do', async () => {
    const { sweep } = setup()
    expect(await sweep()).toEqual({ takenDownObjectsRemoved: 0, discarded: 0, failed: 0 })
  })

  describe('objects of taken-down assets', () => {
    it('removes the object and records it', async () => {
      const { sweep, mediaRepo, objects, add } = setup()
      const asset = await add()
      await mediaRepo.markTakenDown(ORG, asset.id, OLD)

      expect(await sweep()).toMatchObject({ takenDownObjectsRemoved: 1, failed: 0 })

      expect(objects.objects().has(asset.objectKey)).toBe(false)
      expect(await mediaRepo.findById(ORG, asset.id)).toMatchObject({
        status: 'taken_down',
        objectDeletedAt: NOW,
      })
    })

    it('leaves it for the next run when the store fails, and carries on with the others', async () => {
      const { sweep, mediaRepo, objects, add, errors } = setup()
      const first = await add()
      const second = await add()
      await mediaRepo.markTakenDown(ORG, first.id, OLD)
      await mediaRepo.markTakenDown(ORG, second.id, NOW)
      objects.failNextDelete(new Error('store unavailable'))

      expect(await sweep()).toMatchObject({ takenDownObjectsRemoved: 1, failed: 1 })
      expect((await mediaRepo.findById(ORG, first.id))?.objectDeletedAt).toBeNull()
      expect((await mediaRepo.findById(ORG, second.id))?.objectDeletedAt).toEqual(NOW)
      expect(errors).toEqual([
        { assetId: first.id, errorCode: 'portal_media_sweep_object_failed' },
      ])

      expect(await sweep()).toMatchObject({ takenDownObjectsRemoved: 1, failed: 0 })
      expect(objects.objects().has(first.objectKey)).toBe(false)
    })

    it('does not touch the object of an asset that is still active', async () => {
      const { sweep, objects, add, mediaRepo } = setup()
      const asset = await add({ createdAt: RECENT })
      mediaRepo.markReferenced(asset.id)
      await sweep()
      expect(objects.objects().has(asset.objectKey)).toBe(true)
    })
  })

  describe('images nothing refers to', () => {
    it('collects an old, unreferenced image: object and row', async () => {
      const { sweep, mediaRepo, objects, add } = setup()
      const lonely = await add()

      expect(await sweep()).toMatchObject({ discarded: 1, failed: 0 })

      expect(objects.objects().has(lonely.objectKey)).toBe(false)
      expect(await mediaRepo.findById(ORG, lonely.id)).toBeNull()
    })

    it('keeps an image something still refers to, however old', async () => {
      const { sweep, mediaRepo, objects, add } = setup()
      const used = await add({ createdAt: new Date('2020-01-01T00:00:00Z') })
      mediaRepo.markReferenced(used.id)

      expect(await sweep()).toMatchObject({ discarded: 0 })
      expect(objects.objects().has(used.objectKey)).toBe(true)
      expect(await mediaRepo.findById(ORG, used.id)).not.toBeNull()
    })

    it('keeps an image still inside the grace period, so an upload being attached is safe', async () => {
      const { sweep, mediaRepo, objects, add } = setup()
      const fresh = await add({ createdAt: RECENT })

      expect(await sweep()).toMatchObject({ discarded: 0 })
      expect(objects.objects().has(fresh.objectKey)).toBe(true)
      expect(await mediaRepo.findById(ORG, fresh.id)).not.toBeNull()
    })

    it('keeps the row when the object could not be removed, and counts the failure', async () => {
      const { sweep, mediaRepo, objects, add, errors } = setup()
      const lonely = await add()
      objects.failNextDelete(new Error('store unavailable'))

      expect(await sweep()).toMatchObject({ discarded: 0, failed: 1 })
      expect(await mediaRepo.findById(ORG, lonely.id)).not.toBeNull()
      expect(errors).toEqual([
        { assetId: lonely.id, errorCode: 'portal_media_sweep_object_failed' },
      ])

      expect(await sweep()).toMatchObject({ discarded: 1, failed: 0 })
      expect(await mediaRepo.findById(ORG, lonely.id)).toBeNull()
    })

    it('does not collect a taken-down image: its row stays for the snapshots that name it', async () => {
      const { sweep, mediaRepo, add } = setup()
      const down = await add()
      await mediaRepo.markTakenDown(ORG, down.id, OLD)
      await sweep()
      expect(await mediaRepo.findById(ORG, down.id)).toMatchObject({
        status: 'taken_down',
      })
    })
  })

  it('works through at most one batch of each kind per run', async () => {
    const { sweep, add } = setup()
    for (let i = 0; i < MEDIA_SWEEP_BATCH_SIZE + 5; i += 1) await add()
    expect(await sweep()).toMatchObject({ discarded: MEDIA_SWEEP_BATCH_SIZE })
    expect(await sweep()).toMatchObject({ discarded: 5 })
  })
})
