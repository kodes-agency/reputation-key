import { describe, expect, it, vi } from 'vitest'
import {
  PENDING_UPLOAD_GRACE_MS,
  reclaimPendingIdentityUploads,
} from './reclaim-pending-identity-uploads'

const NOW = new Date('2026-11-10T12:00:00.000Z')
const OLD = new Date(NOW.getTime() - PENDING_UPLOAD_GRACE_MS - 1000)
const FRESH = new Date(NOW.getTime() - PENDING_UPLOAD_GRACE_MS + 60_000)
const ID_A = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const ID_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

type Listed = ReadonlyArray<{ key: string; lastModified: Date | null }>

const setup = (
  stored: Readonly<Record<string, Listed>>,
  referenced: ReadonlyArray<string> = [],
) => {
  const deleteObject = vi.fn().mockResolvedValue(undefined)
  const listObjects = vi.fn(async (prefix: string, _max?: number, _after?: string) => ({
    objects: stored[prefix] ?? [],
    truncated: false,
  }))
  const logger = { warn: vi.fn(), info: vi.fn() }
  const reclaim = reclaimPendingIdentityUploads({
    storage: { listObjects, deleteObject },
    isReferenced: async (key) => referenced.includes(key),
    clock: () => NOW,
    logger,
  })
  return { reclaim, deleteObject, listObjects, logger }
}

describe('reclaimPendingIdentityUploads', () => {
  it('deletes an avatar and a logo upload that was never saved once its address has expired', async () => {
    const { reclaim, deleteObject } = setup({
      'avatars/': [{ key: `avatars/u1/${ID_A}`, lastModified: OLD }],
      'organizations/': [{ key: `organizations/o1/logo/${ID_B}`, lastModified: OLD }],
    })

    const outcome = await reclaim()

    expect(deleteObject).toHaveBeenCalledTimes(2)
    expect(deleteObject).toHaveBeenCalledWith(`avatars/u1/${ID_A}`)
    expect(deleteObject).toHaveBeenCalledWith(`organizations/o1/logo/${ID_B}`)
    expect(outcome).toMatchObject({ reclaimed: 2, failed: 0 })
  })

  it('keeps an object something still points at', async () => {
    const key = `avatars/u1/${ID_A}`
    const { reclaim, deleteObject } = setup(
      { 'avatars/': [{ key, lastModified: OLD }] },
      [key],
    )

    await reclaim()

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('keeps an upload whose signed address may still be used', async () => {
    const { reclaim, deleteObject } = setup({
      'avatars/': [{ key: `avatars/u1/${ID_A}`, lastModified: FRESH }],
    })

    await reclaim()

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('keeps an object whose age the store does not report', async () => {
    const { reclaim, deleteObject } = setup({
      'avatars/': [{ key: `avatars/u1/${ID_A}`, lastModified: null }],
    })

    await reclaim()

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('never touches an object that is not an avatar or logo key', async () => {
    const { reclaim, deleteObject } = setup({
      'organizations/': [
        { key: `organizations/o1/export/${ID_A}`, lastModified: OLD },
        { key: 'organizations/o1/logo/not-a-uuid', lastModified: OLD },
      ],
    })

    await reclaim()

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('goes on with the rest when one delete fails, and reports it by kind only', async () => {
    const { reclaim, deleteObject, logger } = setup({
      'avatars/': [
        { key: `avatars/u1/${ID_A}`, lastModified: OLD },
        { key: `avatars/u2/${ID_B}`, lastModified: OLD },
      ],
    })
    deleteObject.mockRejectedValueOnce(new Error('store down'))

    const outcome = await reclaim()

    expect(deleteObject).toHaveBeenCalledTimes(2)
    expect(outcome).toMatchObject({ reclaimed: 1, failed: 1 })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('u1')
  })

  it('reaches an abandoned upload that sits behind a full page of live pictures', async () => {
    const live = Array.from({ length: 1000 }, (_, n) => ({
      key: `avatars/u${String(n).padStart(4, '0')}/${ID_A}`,
      lastModified: OLD,
    }))
    const abandoned = { key: `avatars/z9/${ID_B}`, lastModified: OLD }
    const { reclaim, deleteObject, listObjects } = setup(
      {},
      live.map((o) => o.key),
    )
    listObjects.mockImplementation(
      async (prefix: string, _max?: number, after?: string) =>
        prefix !== 'avatars/'
          ? { objects: [], truncated: false }
          : after
            ? { objects: [abandoned], truncated: false }
            : { objects: live, truncated: true },
    )

    const outcome = await reclaim()

    expect(listObjects).toHaveBeenCalledWith('avatars/', 1000, live[999]?.key)
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(abandoned.key)
    expect(outcome).toMatchObject({ reclaimed: 1, listingTruncated: false })
  })

  it('warns and reports truncation when the scan cap is reached', async () => {
    const page = Array.from({ length: 1000 }, (_, n) => ({
      key: `avatars/u${n}/${ID_A}`,
      lastModified: FRESH,
    }))
    const { reclaim, listObjects, logger } = setup({})
    listObjects.mockImplementation(async (prefix: string) => ({
      objects: prefix === 'avatars/' ? page : [],
      truncated: prefix === 'avatars/',
    }))

    const outcome = await reclaim()

    expect(outcome.listingTruncated).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'identity_pending_upload_scan_capped' }),
      expect.any(String),
    )
  })

  it('stops after the delete limit and says more remain', async () => {
    const many = Array.from({ length: 201 }, (_, n) => ({
      key: `avatars/u${n}/${ID_A}`,
      lastModified: OLD,
    }))
    const { reclaim, deleteObject } = setup({ 'avatars/': many })

    const outcome = await reclaim()

    expect(deleteObject).toHaveBeenCalledTimes(200)
    expect(outcome.listingTruncated).toBe(true)
  })
})
