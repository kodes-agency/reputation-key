import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { createReviewProviderSubjectKeyInventoryRepository } from './provider-subject-key-inventory.repository'

function database(execute: (query: unknown) => Promise<unknown>): Database {
  return { execute } as unknown as Database
}

const DIGEST_V1 = '1a'.repeat(32)
const DIGEST_V2 = '2b'.repeat(32)

describe('Review provider-subject key inventory repository', () => {
  it('strictly parses the masked inventory and bigint counters', async () => {
    const repository = createReviewProviderSubjectKeyInventoryRepository(
      database(async () => ({
        rows: [
          {
            key_version: 'v1',
            key_digest: DIGEST_V1,
            state: 'retiring',
            generation: '1',
            reference_count: '7',
          },
          {
            key_version: 'v2',
            key_digest: DIGEST_V2,
            state: 'active',
            generation: '2',
            reference_count: '0',
          },
        ],
      })),
    )

    await expect(repository.readInventory()).resolves.toEqual([
      {
        version: 'v1',
        digest: DIGEST_V1,
        state: 'retiring',
        generation: 1,
        referenceCount: 7,
      },
      {
        version: 'v2',
        digest: DIGEST_V2,
        state: 'active',
        generation: 2,
        referenceCount: 0,
      },
    ])
  })

  it.each([
    ['unsafe generation', '9007199254740992', '0'],
    ['negative references', '1', '-1'],
    ['noncanonical generation', '01', '0'],
  ])('rejects %s from the database', async (_label, generation, referenceCount) => {
    const repository = createReviewProviderSubjectKeyInventoryRepository(
      database(async () => ({
        rows: [
          {
            key_version: 'v1',
            key_digest: DIGEST_V1,
            state: 'active',
            generation,
            reference_count: referenceCount,
          },
        ],
      })),
    )

    await expect(repository.readInventory()).rejects.toThrow('inventory_invalid')
  })

  it('calls only the fixed schema-qualified rotation functions', async () => {
    const execute = vi.fn(async () => ({ rows: [] }))
    const repository = createReviewProviderSubjectKeyInventoryRepository(
      database(execute),
    )

    await repository.stageTrustedNext({
      expectedActiveVersion: 'v1',
      trustedNextVersion: 'v2',
      trustedNextDigest: DIGEST_V2,
    })
    await repository.activateTrustedNext({
      expectedActiveVersion: 'v1',
      expectedTrustedNextVersion: 'v2',
    })
    await repository.removeRetiring({ expectedRetiringVersion: 'v1' })

    const queries = JSON.stringify(execute.mock.calls)
    expect(queries).toContain('public.trust_next_review_provider_subject_hmac_key_v1')
    expect(queries).toContain('public.rotate_review_provider_subject_hmac_key_v1')
    expect(queries).toContain('public.remove_review_provider_subject_hmac_key_v1')
    expect(queries).not.toContain('REVIEW_PROVIDER_SUBJECT_HMAC_KEYS')
  })
})
