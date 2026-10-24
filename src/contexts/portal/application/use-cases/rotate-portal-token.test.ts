import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { PortalAddressFormat } from '../portal-address-urls'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { issueToken } from '../../domain/portal-token'
import { createInMemoryPortalAddressRepo } from '#/shared/testing/in-memory-portal-address-repo'
import { createInMemoryPortalAddressCipher } from '#/shared/testing/in-memory-portal-address-cipher'
import { portalError } from '../../domain/errors'
import { testPortalTokenCodec } from '../../infrastructure/testing/portal-token-codec-fixture'
import { rotatePortalToken } from './rotate-portal-token'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const staffPublicApi = {
  getAccessiblePropertyIds: vi.fn(async () => null),
} as unknown as StaffPublicApi
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://example.test',
  printOrigin: 'https://ap.example.test',
  printCodesEnabled: false,
}

describe('rotatePortalToken', () => {
  it('atomically saves QR and NFC replacements with the 30-day planned window', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const current = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-token-id',
      tokenHash: 'old-token-hash',
      tokenKeyVersion: 1,
      version: 4,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })
    const saveRotation = vi.fn(async () => undefined)
    const outbox = createRecordedOutbox()
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => current),
      saveRotation,
    } as unknown as PortalTokenRepository
    const ids = [
      '6a200000-0000-4000-8000-000000000001',
      '6a200000-0000-4000-8000-000000000002',
      '6a200000-0000-4000-8000-000000000003',
    ]
    const useCase = rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: null,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      idGen: () => ids.shift()!,
      clock: () => NOW,
      reportPrintCodeProblem: vi.fn(),
      address: ADDRESS,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })

    const rotated = await useCase({ portalId: portal.id }, buildTestAuthContext())

    const long = (artifactId: string) =>
      `https://example.test/p/${rotated.rawToken}?accessArtifact=${artifactId}`
    expect(rotated).toEqual({
      rawToken: expect.stringMatching(/^pt_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/u),
      publicUrl: long('6a200000-0000-4000-8000-000000000002'),
      publicUrls: {
        qr: long('6a200000-0000-4000-8000-000000000002'),
        nfc: long('6a200000-0000-4000-8000-000000000003'),
        direct: `https://example.test/p/${rotated.rawToken}`,
      },
      tokenIdentifier: expect.any(String),
      version: 5,
      gracePeriodEnds: new Date('2026-09-15T12:00:00.000Z'),
      addressRecoverable: false,
    })
    expect(saveRotation).toHaveBeenCalledWith({
      oldToken: expect.objectContaining({
        tokenIdentifier: 'old-token-id',
        status: 'rotating',
      }),
      newToken: expect.objectContaining({
        tokenIdentifier: rotated.tokenIdentifier,
        version: 5,
        status: 'active',
      }),
    })
    expect(outbox.byTag('portal.token.rotated')).toHaveLength(1)
    expect(outbox.byTag('portal.access_artifact.published')).toEqual([
      expect.objectContaining({
        accessArtifactId: '6a200000-0000-4000-8000-000000000002',
        portalId: portal.id,
        channel: 'qr',
        occurredAt: NOW,
      }),
      expect.objectContaining({
        accessArtifactId: '6a200000-0000-4000-8000-000000000003',
        portalId: portal.id,
        channel: 'nfc',
        occurredAt: NOW,
      }),
    ])
  })

  it.each([0, 1.5, 91])(
    'rejects an invalid planned replacement window before reading the active token: %s days',
    async (gracePeriodDays) => {
      const portalRepo = createInMemoryPortalRepo()
      const portal = buildTestPortal()
      portalRepo.seed([portal])
      const findLatestForPortal = vi.fn()
      const portalTokenRepo = {
        findLatestForPortal,
      } as unknown as PortalTokenRepository
      const outbox = createRecordedOutbox()
      const useCase = rotatePortalToken({
        portalRepo,
        portalTokenRepo,
        tokenCodec: testPortalTokenCodec(),
        addressCipher: null,
        staffPublicApi,
        commandStore: createInMemoryPortalCommandStore({
          portalRepo,
          portalTokenRepo,
          outbox,
        }),
        idGen: () => 'portal-token-2',
        clock: () => NOW,
        reportPrintCodeProblem: vi.fn(),
        address: ADDRESS,
        defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
      })

      await expect(
        useCase(
          { portalId: portal.id, replacementKind: 'planned', gracePeriodDays },
          buildTestAuthContext(),
        ),
      ).rejects.toMatchObject({ code: 'token_unavailable' })
      expect(findLatestForPortal).not.toHaveBeenCalled()
    },
  )

  it('supports an immediate security replacement with no printed-code grace', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const current = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-token-id',
      tokenHash: 'old-token-hash',
      tokenKeyVersion: 1,
      version: 1,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => current),
      saveRotation: vi.fn(async () => undefined),
    } as unknown as PortalTokenRepository
    const ids = [
      '6a200000-0000-4000-8000-000000000011',
      '6a200000-0000-4000-8000-000000000012',
      '6a200000-0000-4000-8000-000000000013',
    ]
    const outbox = createRecordedOutbox()
    const useCase = rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: null,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      idGen: () => ids.shift()!,
      clock: () => NOW,
      reportPrintCodeProblem: vi.fn(),
      address: ADDRESS,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })

    await expect(
      useCase(
        { portalId: portal.id, replacementKind: 'security' },
        buildTestAuthContext(),
      ),
    ).resolves.toMatchObject({ gracePeriodEnds: NOW })
  })

  it('requires an active current token', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
    } as unknown as PortalTokenRepository
    const outbox = createRecordedOutbox()
    const useCase = rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: null,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      idGen: () => 'portal-token-2',
      clock: () => NOW,
      reportPrintCodeProblem: vi.fn(),
      address: ADDRESS,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
  })

  it('replaces the sealed address: the new code is sealed and the outgoing one is cleared', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const current = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-token-id',
      tokenHash: 'old-token-hash',
      tokenKeyVersion: 1,
      version: 4,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => current),
      saveRotation: vi.fn(async () => undefined),
    } as unknown as PortalTokenRepository
    const portalAddressRepo = createInMemoryPortalAddressRepo()
    const ctx = buildTestAuthContext()
    // The outgoing code had a sealed copy; rotation must not leave it behind.
    portalAddressRepo.store(
      { organizationId: ctx.organizationId, portalId: portal.id },
      {
        tokenId: current.id,
        propertyId: portal.propertyId,
        version: current.version,
        issuedAt: current.issuedAt,
        sealed: { ciphertext: 'old', keyVersion: 1 },
        accessArtifactIds: { qr: 'q', nfc: 'n' },
        printCodeHashes: { qr: null, nfc: null },
      },
    )
    const ids = [
      '6a200000-0000-4000-8000-000000000001',
      '6a200000-0000-4000-8000-000000000002',
      '6a200000-0000-4000-8000-000000000003',
    ]
    const useCase = rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: createInMemoryPortalAddressCipher({ activeKeyVersion: 2 }),
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        portalAddressRepo,
        outbox: createRecordedOutbox(),
      }),
      idGen: () => ids.shift()!,
      clock: () => NOW,
      reportPrintCodeProblem: vi.fn(),
      address: ADDRESS,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })

    const rotated = await useCase({ portalId: portal.id }, ctx)

    expect(rotated.addressRecoverable).toBe(true)
    const live = await portalAddressRepo.findRevealable(ctx.organizationId, portal.id)
    expect(live).toMatchObject({
      tokenId: '6a200000-0000-4000-8000-000000000001',
      version: 5,
      sealed: { keyVersion: 2 },
    })
    expect(portalAddressRepo.sealedCount()).toBe(1)
  })
})

describe('rotatePortalToken — print codes (ADR 0069)', () => {
  const RECORDS = [
    '6a200000-0000-4000-8000-000000000021',
    '6a200000-0000-4000-8000-000000000022',
    '6a200000-0000-4000-8000-000000000023',
  ] as const

  /** The use case over the in-memory stores, recording what the store was asked to write. */
  function setup(
    options: Readonly<{
      address?: PortalAddressFormat
      commandStore?: (inner: PortalCommandStore) => PortalCommandStore
    }> = {},
  ) {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const current = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-token-id',
      tokenHash: 'old-token-hash',
      tokenKeyVersion: 1,
      version: 1,
      now: new Date('2026-08-01T12:00:00.000Z'),
    })
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => current),
      saveRotation: vi.fn(async () => undefined),
    } as unknown as PortalTokenRepository
    const outbox = createRecordedOutbox()
    const inner = createInMemoryPortalCommandStore({
      portalRepo,
      portalTokenRepo,
      outbox,
    })
    const rotated: Parameters<PortalCommandStore['rotatePortalToken']>[0][] = []
    const recording: PortalCommandStore = {
      ...inner,
      rotatePortalToken: async (command) => {
        rotated.push(command)
        return inner.rotatePortalToken(command)
      },
    }
    const reportPrintCodeProblem = vi.fn()
    const tokenCodec = testPortalTokenCodec()
    const ids = [...RECORDS]
    const useCase = rotatePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec,
      addressCipher: null,
      staffPublicApi,
      commandStore: options.commandStore ? options.commandStore(recording) : recording,
      reportPrintCodeProblem,
      idGen: () => ids.shift() ?? 'extra-id',
      clock: () => NOW,
      address: options.address ?? ADDRESS,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    })
    return {
      portal,
      outbox,
      rotated,
      tokenCodec,
      reportPrintCodeProblem,
      run: () => useCase({ portalId: portal.id }, buildTestAuthContext()),
    }
  }

  it('gives the new code its own two hashes, derived from its address and its two markers', async () => {
    const { run, rotated, tokenCodec } = setup()

    const result = await run()

    const derived = tokenCodec.derivePrintCodes({
      rawToken: result.rawToken,
      accessArtifactIds: { qr: RECORDS[1], nfc: RECORDS[2] },
    })
    expect(rotated[0]?.printCodeHashes).toEqual({
      qr: derived?.qr.printCodeHash,
      nfc: derived?.nfc.printCodeHash,
    })
  })

  it('shows the short addresses when switched on, and the long one only as direct', async () => {
    const { run, tokenCodec } = setup({
      address: { ...ADDRESS, printCodesEnabled: true },
    })

    const result = await run()

    const derived = tokenCodec.derivePrintCodes({
      rawToken: result.rawToken,
      accessArtifactIds: { qr: RECORDS[1], nfc: RECORDS[2] },
    })
    expect(result.publicUrls).toEqual({
      qr: `HTTPS://AP.EXAMPLE.TEST/p/${derived?.qr.printCode}`,
      nfc: `https://ap.example.test/p/${derived?.nfc.printCode}`,
      direct: `https://example.test/p/${result.rawToken}`,
    })
  })

  it('reports a refused hash and lets the refusal through, so the manager presses the button again', async () => {
    const refusal = portalError(
      'print_code_collision',
      'The new code could not be saved.',
    )
    const { run, reportPrintCodeProblem } = setup({
      commandStore: (inner) => ({
        ...inner,
        rotatePortalToken: async () => {
          throw refusal
        },
      }),
    })

    await expect(run()).rejects.toBe(refusal)

    expect(reportPrintCodeProblem.mock.calls).toEqual([['collision']])
  })

  it('keeps every print code, its hash and the address out of the events it records', async () => {
    const { run, outbox, rotated } = setup({
      address: { ...ADDRESS, printCodesEnabled: true },
    })

    const result = await run()

    const recorded = JSON.stringify(outbox.facts)
    expect(outbox.facts.length).toBeGreaterThanOrEqual(3)
    const hashes = rotated[0]?.printCodeHashes
    const printCode = result.publicUrls.qr.split('/p/')[1] ?? ''
    for (const secret of [result.rawToken, printCode, hashes?.qr, hashes?.nfc]) {
      expect(secret).toBeTruthy()
      expect(recorded).not.toContain(secret)
    }
  })
})
