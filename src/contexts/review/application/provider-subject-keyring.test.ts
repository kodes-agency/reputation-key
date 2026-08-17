import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import {
  configureReviewProviderSubjectWriterKeys,
  createReviewProviderSubjectKeyService,
  createReviewProviderSubjectSecretKeyring,
  ReviewProviderSubjectKeyError,
  withSealedReviewProviderSubjectKeys,
  type ReviewProviderSubjectKeyInventoryEntry,
  type ReviewProviderSubjectKeyInventoryRepository,
  type ReviewProviderSubjectSecretKeyring,
} from './provider-subject-keyring'

const KEY_ONE = '11'.repeat(32)
const KEY_TWO = '22'.repeat(32)
const SCOPE = Object.freeze({
  organizationId: '00000000-0000-4000-8000-000000000001',
  propertyId: '00000000-0000-4000-8000-000000000002',
  sourceEpoch: 7,
  resourceName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
})

function keyErrorCode(error: unknown): string | null {
  return error instanceof ReviewProviderSubjectKeyError ? error.code : null
}

function configured() {
  return createReviewProviderSubjectSecretKeyring(`v1:${KEY_ONE},v2:${KEY_TWO}`)
}

function row(
  keyring: ReviewProviderSubjectSecretKeyring,
  version: 'v1' | 'v2',
  state: ReviewProviderSubjectKeyInventoryEntry['state'],
  generation: number,
  referenceCount = 0,
): ReviewProviderSubjectKeyInventoryEntry {
  const masked = keyring.maskedInventory.find((entry) => entry.version === version)
  if (!masked) throw new Error('test key missing')
  return Object.freeze({ ...masked, state, generation, referenceCount })
}

function fakeRepository(
  initial: readonly ReviewProviderSubjectKeyInventoryEntry[],
): ReviewProviderSubjectKeyInventoryRepository & {
  current(): readonly ReviewProviderSubjectKeyInventoryEntry[]
} {
  let rows = [...initial]
  return {
    readInventory: vi.fn(async () => Object.freeze([...rows])),
    stageTrustedNext: vi.fn(async (input) => {
      const active = rows.find((entry) => entry.state === 'active')
      if (
        rows.length !== 1 ||
        !active ||
        active.version !== input.expectedActiveVersion ||
        input.trustedNextVersion === active.version
      ) {
        throw new Error('trusted-next denied')
      }
      rows = [
        active,
        {
          version: input.trustedNextVersion,
          digest: input.trustedNextDigest,
          state: 'trusted_next',
          generation: active.generation + 1,
          referenceCount: 0,
        },
      ]
    }),
    activateTrustedNext: vi.fn(async (input) => {
      const active = rows.find((entry) => entry.state === 'active')
      const trusted = rows.find((entry) => entry.state === 'trusted_next')
      if (
        !active ||
        !trusted ||
        active.version !== input.expectedActiveVersion ||
        trusted.version !== input.expectedTrustedNextVersion
      ) {
        throw new Error('rotation denied')
      }
      rows = [
        { ...active, state: 'retiring' },
        { ...trusted, state: 'active' },
      ]
    }),
    removeRetiring: vi.fn(async (input) => {
      const retiring = rows.find((entry) => entry.state === 'retiring')
      if (
        !retiring ||
        retiring.version !== input.expectedRetiringVersion ||
        retiring.referenceCount !== 0
      ) {
        throw new Error('removal denied')
      }
      rows = rows.filter((entry) => entry !== retiring)
    }),
    current: () => Object.freeze([...rows]),
  }
}
describe('Review provider-subject env placement', () => {
  it('does not decode or retain writer keys in a non-writer process', () => {
    expect(
      configureReviewProviderSubjectWriterKeys({
        writerEnabled: false,
        production: true,
        raw: `v1:${KEY_ONE}`,
      }),
    ).toBeUndefined()
  })

  it('fails closed when a production writer has no dedicated key input', () => {
    expect(() =>
      configureReviewProviderSubjectWriterKeys({
        writerEnabled: true,
        production: true,
        raw: undefined,
      }),
    ).toThrow('config_invalid')
  })

  it('allows an unconfigured non-production writer only as deny-only wiring', () => {
    expect(
      configureReviewProviderSubjectWriterKeys({
        writerEnabled: true,
        production: false,
        raw: undefined,
      }),
    ).toBeUndefined()
  })
})

describe('Review provider-subject secret keyring', () => {
  it('accepts one or two distinct exact 32-byte keys and exposes only masked digests', () => {
    const one = createReviewProviderSubjectSecretKeyring(`v1:${KEY_ONE}`)
    const two = configured()

    expect(one.maskedInventory).toEqual([
      { version: 'v1', digest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ])
    expect(two.maskedInventory.map((entry) => entry.version)).toEqual(['v1', 'v2'])
    expect(JSON.stringify(two)).not.toContain(KEY_ONE)
    expect(JSON.stringify(two)).not.toContain(KEY_TWO)
  })

  it.each([
    '',
    `v1:${'11'.repeat(31)}`,
    `v1:${'11'.repeat(33)}`,
    `V1:${KEY_ONE}`,
    `v1:${KEY_ONE} `,
    `v1:${KEY_ONE},`,
    `v1:${KEY_ONE},v1:${KEY_TWO}`,
    `v1:${KEY_ONE},v2:${KEY_ONE}`,
    `v1:${KEY_ONE},v2:${KEY_TWO},v3:${'33'.repeat(32)}`,
  ])('fails closed for malformed or unsafe config without echoing it: %s', (raw) => {
    let failure: unknown
    try {
      createReviewProviderSubjectSecretKeyring(raw)
    } catch (error) {
      failure = error
    }
    expect(keyErrorCode(failure)).toBe('config_invalid')
    expect((failure as Error).message).toBe('config_invalid')
    if (raw.length > 0) expect((failure as Error).message).not.toContain(raw)
  })

  it('zeroes and permanently disables decoded sealed-migrator keys after success', async () => {
    let captured: ReviewProviderSubjectSecretKeyring | undefined
    await withSealedReviewProviderSubjectKeys(`v1:${KEY_ONE}`, async (keyring) => {
      captured = keyring
      expect(keyring.derive('v1', SCOPE)?.locatorHmac).toHaveLength(32)
    })

    expect(() => captured?.derive('v1', SCOPE)).toThrow('keyring_destroyed')
  })

  it('zeroes and disables decoded sealed-migrator keys after callback failure', async () => {
    let captured: ReviewProviderSubjectSecretKeyring | undefined
    await expect(
      withSealedReviewProviderSubjectKeys(`v1:${KEY_ONE}`, async (keyring) => {
        captured = keyring
        throw new Error('migrator failed')
      }),
    ).rejects.toThrow('migrator failed')

    expect(() => captured?.derive('v1', SCOPE)).toThrow('keyring_destroyed')
  })
})

describe('Review provider-subject inventory readiness', () => {
  it('selects active from database state and ignores trusted-next for derivation', async () => {
    const keyring = configured()
    const repository = fakeRepository([
      row(keyring, 'v1', 'active', 1),
      row(keyring, 'v2', 'trusted_next', 2),
    ])
    const service = createReviewProviderSubjectKeyService({ keyring, repository })

    const deriver = await service.acquireDeriver()
    const candidates = deriver.deriveCandidates(SCOPE)

    expect(deriver).toMatchObject({
      activeVersion: 'v1',
      retiringVersion: null,
      inventoryGeneration: 2,
    })
    expect(candidates.map((candidate) => candidate.keyVersion)).toEqual(['v1'])
  })

  it('derives active then retiring for lazy rekey lookup', async () => {
    const keyring = configured()
    const repository = fakeRepository([
      row(keyring, 'v1', 'retiring', 1, 4),
      row(keyring, 'v2', 'active', 2),
    ])
    const deriver = await createReviewProviderSubjectKeyService({
      keyring,
      repository,
    }).acquireDeriver()

    const candidates = deriver.deriveCandidates(SCOPE)
    expect(candidates.map((candidate) => candidate.keyVersion)).toEqual(['v2', 'v1'])
    expect(candidates[0].locatorHmac).not.toEqual(candidates[1].locatorHmac)
    expect(candidates[0].verifierHmac).not.toEqual(candidates[1].verifierHmac)
  })

  it.each(['missing configured version', 'extra configured version', 'digest mismatch'])(
    'fails exact inventory parity for %s',
    async (variant) => {
      const keyring = configured()
      let inventory: readonly ReviewProviderSubjectKeyInventoryEntry[]
      if (variant === 'missing configured version') {
        inventory = [row(keyring, 'v1', 'active', 1)]
      } else if (variant === 'extra configured version') {
        const one = createReviewProviderSubjectSecretKeyring(`v1:${KEY_ONE}`)
        const repository = fakeRepository([
          row(keyring, 'v1', 'active', 1),
          row(keyring, 'v2', 'trusted_next', 2),
        ])
        await expect(
          createReviewProviderSubjectKeyService({
            keyring: one,
            repository,
          }).acquireDeriver(),
        ).rejects.toMatchObject({ code: 'inventory_mismatch' })
        return
      } else {
        inventory = [
          row(keyring, 'v1', 'active', 1),
          { ...row(keyring, 'v2', 'trusted_next', 2), digest: 'f'.repeat(64) },
        ]
      }

      await expect(
        createReviewProviderSubjectKeyService({
          keyring,
          repository: fakeRepository(inventory),
        }).acquireDeriver(),
      ).rejects.toMatchObject({ code: 'inventory_mismatch' })
    },
  )

  it.each(
    [
      [] as readonly ReviewProviderSubjectKeyInventoryEntry[],
      [
        {
          version: 'v1',
          digest: 'a'.repeat(64),
          state: 'active',
          generation: 1,
          referenceCount: 0,
        },
        {
          version: 'v2',
          digest: 'b'.repeat(64),
          state: 'active',
          generation: 2,
          referenceCount: 0,
        },
      ] as const,
      [
        {
          version: 'v1',
          digest: 'a'.repeat(64),
          state: 'active',
          generation: 2,
          referenceCount: 0,
        },
        {
          version: 'v2',
          digest: 'b'.repeat(64),
          state: 'retiring',
          generation: 3,
          referenceCount: 0,
        },
      ] as const,
      [
        {
          version: 'v1',
          digest: 'a'.repeat(64),
          state: 'active',
          generation: 1,
          referenceCount: -1,
        },
      ] as const,
    ].map((inventory) => [inventory] as const),
  )('rejects invalid persisted state layouts', async (inventory) => {
    const keyring = configured()
    await expect(
      createReviewProviderSubjectKeyService({
        keyring,
        repository: fakeRepository(inventory),
      }).acquireDeriver(),
    ).rejects.toMatchObject({ code: 'inventory_invalid' })
  })

  it('maps repository read failure to a code-only unavailable result', async () => {
    const keyring = configured()
    const repository: ReviewProviderSubjectKeyInventoryRepository = {
      readInventory: async () => {
        throw new Error(`database leaked ${KEY_ONE}`)
      },
      stageTrustedNext: async () => undefined,
      activateTrustedNext: async () => undefined,
      removeRetiring: async () => undefined,
    }

    let failure: unknown
    try {
      await createReviewProviderSubjectKeyService({
        keyring,
        repository,
      }).acquireDeriver()
    } catch (error) {
      failure = error
    }
    expect(keyErrorCode(failure)).toBe('inventory_unavailable')
    expect((failure as Error).message).toBe('inventory_unavailable')
    expect((failure as Error).message).not.toContain(KEY_ONE)
  })
})

describe('Review provider-subject two-phase rotation', () => {
  it('stages only the configured masked next digest beside a lone active row', async () => {
    const keyring = configured()
    const repository = fakeRepository([row(keyring, 'v1', 'active', 1)])
    const service = createReviewProviderSubjectKeyService({ keyring, repository })

    await service.stageTrustedNext({
      expectedActiveVersion: 'v1',
      trustedNextVersion: 'v2',
    })

    expect(repository.current()).toEqual([
      row(keyring, 'v1', 'active', 1),
      row(keyring, 'v2', 'trusted_next', 2),
    ])
    expect(repository.stageTrustedNext).toHaveBeenCalledWith({
      expectedActiveVersion: 'v1',
      trustedNextVersion: 'v2',
      trustedNextDigest: keyring.maskedInventory[1]!.digest,
    })
  })

  it('blocks trusted-next staging when a second inventory row already exists', async () => {
    const keyring = configured()
    const repository = fakeRepository([
      row(keyring, 'v1', 'retiring', 1),
      row(keyring, 'v2', 'active', 2),
    ])
    const service = createReviewProviderSubjectKeyService({ keyring, repository })

    await expect(
      service.stageTrustedNext({
        expectedActiveVersion: 'v2',
        trustedNextVersion: 'v1',
      }),
    ).rejects.toMatchObject({ code: 'rotation_conflict' })
    expect(repository.stageTrustedNext).not.toHaveBeenCalled()
  })

  it('atomically activates trusted-next and leaves the prior active retiring', async () => {
    const keyring = configured()
    const repository = fakeRepository([
      row(keyring, 'v1', 'active', 1),
      row(keyring, 'v2', 'trusted_next', 2),
    ])
    const service = createReviewProviderSubjectKeyService({ keyring, repository })

    await service.activateTrustedNext({
      expectedActiveVersion: 'v1',
      expectedTrustedNextVersion: 'v2',
    })

    expect(
      repository.current().map(({ version, state }) => ({ version, state })),
    ).toEqual([
      { version: 'v1', state: 'retiring' },
      { version: 'v2', state: 'active' },
    ])
    const deriver = await service.acquireDeriver()
    expect(deriver.deriveCandidates(SCOPE).map((entry) => entry.keyVersion)).toEqual([
      'v2',
      'v1',
    ])
  })

  it('blocks a second rotation while a retiring generation remains', async () => {
    const keyring = configured()
    const repository = fakeRepository([
      row(keyring, 'v1', 'retiring', 1),
      row(keyring, 'v2', 'active', 2),
    ])
    const service = createReviewProviderSubjectKeyService({ keyring, repository })

    await expect(
      service.activateTrustedNext({
        expectedActiveVersion: 'v2',
        expectedTrustedNextVersion: 'v1',
      }),
    ).rejects.toMatchObject({ code: 'rotation_conflict' })
    expect(repository.activateTrustedNext).not.toHaveBeenCalled()
  })

  it('blocks removal while any linked or tombstone mapping still references retiring', async () => {
    const keyring = configured()
    const repository = fakeRepository([
      row(keyring, 'v1', 'retiring', 1, 1),
      row(keyring, 'v2', 'active', 2),
    ])
    const service = createReviewProviderSubjectKeyService({ keyring, repository })

    await expect(
      service.removeRetiring({ expectedRetiringVersion: 'v1' }),
    ).rejects.toMatchObject({ code: 'retiring_key_referenced' })
    expect(repository.removeRetiring).not.toHaveBeenCalled()
  })

  it('removes a zero-reference retiring inventory row and then requires config cutover', async () => {
    const keyring = configured()
    const repository = fakeRepository([
      row(keyring, 'v1', 'retiring', 1),
      row(keyring, 'v2', 'active', 2),
    ])
    const service = createReviewProviderSubjectKeyService({ keyring, repository })

    await service.removeRetiring({ expectedRetiringVersion: 'v1' })
    expect(repository.current().map((entry) => entry.version)).toEqual(['v2'])
    await expect(service.acquireDeriver()).rejects.toMatchObject({
      code: 'inventory_mismatch',
    })
  })
})
