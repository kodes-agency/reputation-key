import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import {
  initializeReviewProviderSubjectKeyInventory,
  initializeReviewProviderSubjectKeyInventoryFromEnvironment,
} from './provider-subject-key-initializer'

const KEY = '11'.repeat(32)

function database(execute: (query: unknown) => Promise<unknown>): Database {
  return { execute } as unknown as Database
}

describe('sealed Review provider-subject key initialization', () => {
  it('persists only one masked version/digest through the migrator function', async () => {
    const execute = vi.fn(async (query: unknown) => {
      expect(JSON.stringify(query)).not.toContain(KEY)
      return { rows: [] }
    })

    const initialized = await initializeReviewProviderSubjectKeyInventory({
      db: database(execute),
      sealedMigratorKeys: `v1:${KEY}`,
    })

    expect(initialized).toEqual({
      version: 'v1',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(initialized)).not.toContain(KEY)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('leaves an already initialized inventory unchanged on a repeated deploy', async () => {
    const execute = vi.fn(async (query: unknown) => {
      const encoded = JSON.stringify(query)
      expect(encoded).toContain('review_provider_subject_hmac_key_versions')
      expect(encoded).not.toContain('initialize_review_provider_subject_hmac_key_v1')
      return { rows: [{ present: 1 }] }
    })

    await expect(
      initializeReviewProviderSubjectKeyInventory({
        db: database(execute),
        sealedMigratorKeys: `v1:${KEY}`,
      }),
    ).resolves.toEqual({
      version: 'v1',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('accepts a concurrent initializer that wins after the empty-inventory read', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error(`database accidentally included ${KEY}`))
      .mockResolvedValueOnce({ rows: [{ present: 1 }] })

    await expect(
      initializeReviewProviderSubjectKeyInventory({
        db: database(execute),
        sealedMigratorKeys: `v1:${KEY}`,
      }),
    ).resolves.toEqual({
      version: 'v1',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('rejects two-key initial seeding before database access', async () => {
    const execute = vi.fn(async () => ({ rows: [] }))

    await expect(
      initializeReviewProviderSubjectKeyInventory({
        db: database(execute),
        sealedMigratorKeys: `v1:${KEY},v2:${'22'.repeat(32)}`,
      }),
    ).rejects.toThrow('provider_subject_key_initialization_invalid')
    expect(execute).not.toHaveBeenCalled()
  })

  it('maps database details to a code-only failure', async () => {
    const execute = vi.fn(async () => {
      throw new Error(`database accidentally included ${KEY}`)
    })

    let failure: unknown
    try {
      await initializeReviewProviderSubjectKeyInventory({
        db: database(execute),
        sealedMigratorKeys: `v1:${KEY}`,
      })
    } catch (error) {
      failure = error
    }

    expect((failure as Error).message).toBe('provider_subject_key_initialization_failed')
    expect((failure as Error).message).not.toContain(KEY)
  })

  it('allows a normal redeploy without a migrator secret after initialization', async () => {
    const execute = vi.fn(async () => ({ rows: [{ present: 1 }] }))

    await expect(
      initializeReviewProviderSubjectKeyInventoryFromEnvironment({
        db: database(execute),
        env: {},
      }),
    ).resolves.toBeNull()
    expect(execute).toHaveBeenCalledOnce()
  })
  it('accepts only the distinct sealed-migrator variable', async () => {
    const execute = vi.fn(async () => ({ rows: [] }))

    await initializeReviewProviderSubjectKeyInventoryFromEnvironment({
      db: database(execute),
      env: {
        REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: `v1:${KEY}`,
      },
    })
    expect(execute).toHaveBeenCalledTimes(2)

    for (const env of [
      { REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: `v1:${KEY}` },
      {
        REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: `v1:${KEY}`,
        REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS: `v1:${KEY}`,
      },
    ]) {
      await expect(
        initializeReviewProviderSubjectKeyInventoryFromEnvironment({
          db: database(execute),
          env,
        }),
      ).rejects.toThrow('provider_subject_key_initialization_invalid')
    }

    await expect(
      initializeReviewProviderSubjectKeyInventoryFromEnvironment({
        db: database(async () => ({ rows: [] })),
        env: {},
      }),
    ).rejects.toThrow('provider_subject_key_initialization_invalid')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
