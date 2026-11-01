import { buildPortalAddressOperations } from '../../build-address-operations'
import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalCommandStore } from '../ports/portal-command-store.port'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalAddressFormat } from '../portal-address-urls'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { issueToken } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { createInMemoryPortalAddressRepo } from '#/shared/testing/in-memory-portal-address-repo'
import { createInMemoryPortalAddressCipher } from '#/shared/testing/in-memory-portal-address-cipher'
import { unbrand } from '#/shared/domain/ids'
import { testPortalTokenCodec } from '../../infrastructure/testing/portal-token-codec-fixture'
import { ensurePersonalPortalToken, issuePortalToken } from './issue-portal-token'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const CURRENT_REVISION = new Date('2026-08-20T12:00:00.000Z')
const NEXT_REVISION = new Date(CURRENT_REVISION.getTime() + 1)
const staffPublicApi = {
  getAccessiblePropertyIds: vi.fn(async () => null),
} as unknown as StaffPublicApi
const QR_ID = '6a100000-0000-4000-8000-000000000002'
const NFC_ID = '6a100000-0000-4000-8000-000000000003'
const IDS = ['6a100000-0000-4000-8000-000000000001', QR_ID, NFC_ID] as const
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://example.test',
  printOrigin: 'https://ap.example.test',
  printCodesEnabled: false,
}

const idSource = () => {
  const ids = [...IDS]
  return () => ids.shift() ?? 'extra-id'
}

describe('issuePortalToken', () => {
  it('persists a tenant-bound token and outbox facts, then returns only public material', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal({ updatedAt: CURRENT_REVISION })
    portalRepo.seed([portal])
    const insert = vi.fn(async () => undefined)
    const outbox = createRecordedOutbox()
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
      insert,
    } as unknown as PortalTokenRepository
    const tokenCodec = testPortalTokenCodec()
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec,
      addressCipher: null,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        outbox,
      }),
      reportPrintCodeProblem: vi.fn(),
      idGen: idSource(),
      clock: () => NOW,
      address: ADDRESS,
    })

    const issued = await useCase({ portalId: portal.id }, buildTestAuthContext())

    const long = (artifactId: string) =>
      `https://example.test/p/${issued.rawToken}?accessArtifact=${artifactId}`
    expect(issued).toEqual({
      rawToken: expect.stringMatching(/^pt_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/u),
      publicUrl: long(QR_ID),
      publicUrls: {
        qr: long(QR_ID),
        nfc: long(NFC_ID),
        direct: `https://example.test/p/${issued.rawToken}`,
      },
      tokenIdentifier: expect.any(String),
      version: 1,
      issuedAt: NOW,
      addressRecoverable: false,
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        tokenHash: expect.any(String),
        printBatch: null,
      }),
    )
    expect(outbox.byTag('portal.token.issued')).toEqual([
      expect.objectContaining({
        sourceAggregateVersion: NEXT_REVISION.toISOString(),
        occurredAt: NOW,
      }),
    ])
    expect(outbox.byTag('portal.access_artifact.published')).toEqual([
      expect.objectContaining({
        accessArtifactId: QR_ID,
        portalId: portal.id,
        channel: 'qr',
        sourceAggregateVersion: NEXT_REVISION.toISOString(),
        occurredAt: NOW,
      }),
      expect.objectContaining({
        accessArtifactId: NFC_ID,
        portalId: portal.id,
        channel: 'nfc',
        sourceAggregateVersion: NEXT_REVISION.toISOString(),
        occurredAt: NOW,
      }),
    ])
    await expect(
      portalRepo.findById(portal.organizationId, portal.id),
    ).resolves.toMatchObject({ updatedAt: NEXT_REVISION })
  })

  it('requires rotation while a non-revoked token exists', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal()
    portalRepo.seed([portal])
    const active = issueToken({
      id: 'portal-token-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenIdentifier: 'old-id',
      tokenHash: 'old-hash',
      tokenKeyVersion: 1,
      version: 1,
      now: NOW,
    })
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => active),
    } as unknown as PortalTokenRepository
    const outbox = createRecordedOutbox()
    const useCase = issuePortalToken({
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
      reportPrintCodeProblem: vi.fn(),
      idGen: () => 'portal-token-2',
      clock: () => NOW,
      address: ADDRESS,
    })

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
  })

  it('seals the address for the new token under its own scope when a cipher is configured', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal({ updatedAt: CURRENT_REVISION })
    portalRepo.seed([portal])
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
      insert: vi.fn(async () => undefined),
    } as unknown as PortalTokenRepository
    const portalAddressRepo = createInMemoryPortalAddressRepo()
    const ctx = buildTestAuthContext()
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: createInMemoryPortalAddressCipher({ activeKeyVersion: 3 }),
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        portalAddressRepo,
        outbox: createRecordedOutbox(),
      }),
      reportPrintCodeProblem: vi.fn(),
      idGen: idSource(),
      clock: () => NOW,
      address: ADDRESS,
    })

    const issued = await useCase({ portalId: portal.id }, ctx)

    expect(issued.addressRecoverable).toBe(true)
    const sealed = await portalAddressRepo.findRevealable(ctx.organizationId, portal.id)
    expect(sealed).toMatchObject({
      tokenId: IDS[0],
      version: 1,
      sealed: { keyVersion: 3 },
      accessArtifactIds: { qr: QR_ID, nfc: NFC_ID },
    })
    // Bound to its own row: the fake refuses any other scope, as the real cipher does.
    expect(sealed?.sealed.ciphertext).toContain(
      `${unbrand(ctx.organizationId)}/${unbrand(portal.propertyId)}/${unbrand(portal.id)}/${IDS[0]}/1`,
    )
  })

  it('keeps the address request-local when no cipher is configured', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal({ updatedAt: CURRENT_REVISION })
    portalRepo.seed([portal])
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
      insert: vi.fn(async () => undefined),
    } as unknown as PortalTokenRepository
    const portalAddressRepo = createInMemoryPortalAddressRepo()
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: null,
      staffPublicApi,
      commandStore: createInMemoryPortalCommandStore({
        portalRepo,
        portalTokenRepo,
        portalAddressRepo,
        outbox: createRecordedOutbox(),
      }),
      reportPrintCodeProblem: vi.fn(),
      idGen: idSource(),
      clock: () => NOW,
      address: ADDRESS,
    })

    await expect(
      useCase({ portalId: portal.id }, buildTestAuthContext()),
    ).resolves.toMatchObject({
      rawToken: expect.stringMatching(/^pt_/u),
      addressRecoverable: false,
    })
    expect(portalAddressRepo.sealedCount()).toBe(0)
  })
})

describe('issuePortalToken — print codes (ADR 0069)', () => {
  /** The use case over the in-memory stores, recording what the store was asked to write. */
  function setup(
    options: Readonly<{
      address?: PortalAddressFormat
      commandStore?: (inner: PortalCommandStore) => PortalCommandStore
    }> = {},
  ) {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal({ updatedAt: CURRENT_REVISION })
    portalRepo.seed([portal])
    const portalTokenRepo = {
      findLatestForPortal: vi.fn(async () => null),
      insert: vi.fn(async () => undefined),
    } as unknown as PortalTokenRepository
    const outbox = createRecordedOutbox()
    const inner = createInMemoryPortalCommandStore({
      portalRepo,
      portalTokenRepo,
      outbox,
    })
    const issued: Parameters<PortalCommandStore['issuePortalToken']>[0][] = []
    const recording: PortalCommandStore = {
      ...inner,
      issuePortalToken: async (command) => {
        issued.push(command)
        return inner.issuePortalToken(command)
      },
    }
    const reportPrintCodeProblem = vi.fn()
    const tokenCodec = testPortalTokenCodec()
    const useCase = issuePortalToken({
      portalRepo,
      portalTokenRepo,
      tokenCodec,
      addressCipher: null,
      staffPublicApi,
      commandStore: options.commandStore ? options.commandStore(recording) : recording,
      reportPrintCodeProblem,
      idGen: idSource(),
      clock: () => NOW,
      address: options.address ?? ADDRESS,
    })
    return {
      portal,
      outbox,
      issued,
      tokenCodec,
      reportPrintCodeProblem,
      run: () => useCase({ portalId: portal.id }, buildTestAuthContext()),
    }
  }

  it('stores both print code hashes with the new code, derived from its address and its two markers', async () => {
    const { run, issued, tokenCodec } = setup()

    const result = await run()

    const derived = tokenCodec.derivePrintCodes({
      rawToken: result.rawToken,
      accessArtifactIds: { qr: QR_ID, nfc: NFC_ID },
    })
    expect(derived).not.toBeNull()
    expect(issued).toHaveLength(1)
    expect(issued[0]?.printCodeHashes).toEqual({
      qr: derived?.qr.printCodeHash,
      nfc: derived?.nfc.printCodeHash,
    })
    expect(derived?.qr.printCodeHash).not.toBe(derived?.nfc.printCodeHash)
  })

  it('mints the hashes even when the short address is switched off, and shows the long one', async () => {
    const { run, issued } = setup({ address: { ...ADDRESS, printCodesEnabled: false } })

    const result = await run()

    expect(issued[0]?.printCodeHashes.qr).toMatch(/^[0-9a-f]{64}$/u)
    expect(result.publicUrls.qr).toContain('?accessArtifact=')
    expect(result.publicUrls.nfc).toContain('?accessArtifact=')
    expect(result.publicUrl).toBe(result.publicUrls.qr)
  })

  it('shows the short addresses, and the long one only as direct, when it is switched on', async () => {
    const { run, tokenCodec } = setup({
      address: { ...ADDRESS, printCodesEnabled: true },
    })

    const result = await run()

    const derived = tokenCodec.derivePrintCodes({
      rawToken: result.rawToken,
      accessArtifactIds: { qr: QR_ID, nfc: NFC_ID },
    })
    expect(result.publicUrls).toEqual({
      qr: `HTTPS://AP.EXAMPLE.TEST/p/${derived?.qr.printCode}`,
      nfc: `https://ap.example.test/p/${derived?.nfc.printCode}`,
      direct: `https://example.test/p/${result.rawToken}`,
    })
    expect(result.publicUrl).toBe(result.publicUrls.qr)
  })

  it('reports a refused hash, with no code in the report, and lets the refusal through', async () => {
    const refusal = portalError(
      'print_code_collision',
      'The new code could not be saved.',
    )
    const { run, reportPrintCodeProblem } = setup({
      commandStore: (inner) => ({
        ...inner,
        issuePortalToken: async () => {
          throw refusal
        },
      }),
    })

    await expect(run()).rejects.toBe(refusal)

    expect(reportPrintCodeProblem.mock.calls).toEqual([['collision']])
  })

  it('does not report a failure that is not a collision', async () => {
    const { run, reportPrintCodeProblem } = setup({
      commandStore: (inner) => ({
        ...inner,
        issuePortalToken: async () => {
          throw portalError('revision_conflict', 'Portal changed')
        },
      }),
    })

    await expect(run()).rejects.toMatchObject({ code: 'revision_conflict' })

    expect(reportPrintCodeProblem).not.toHaveBeenCalled()
  })

  it('keeps every print code, its hash and the address out of the events it records', async () => {
    const { run, outbox, issued } = setup({
      address: { ...ADDRESS, printCodesEnabled: true },
    })

    const result = await run()

    const recorded = JSON.stringify(outbox.facts)
    expect(outbox.facts.length).toBeGreaterThanOrEqual(3)
    const hashes = issued[0]?.printCodeHashes
    const printCode = result.publicUrls.qr.split('/p/')[1] ?? ''
    expect(printCode).toHaveLength(20)
    for (const secret of [result.rawToken, printCode, hashes?.qr, hashes?.nfc]) {
      expect(secret).toBeTruthy()
      expect(recorded).not.toContain(secret)
    }
  })
})

describe('staff code checkpoint retry', () => {
  it('keeps a recoverable existing token, and refuses a missing keyring or sealed address', async () => {
    const portalRepo = createInMemoryPortalRepo()
    const portal = buildTestPortal({ kind: 'personal', publicName: 'Harbor' })
    portalRepo.seed([portal])
    const portalTokenRepo = {
      findLatestForPortal: async () => ({ status: 'active' }),
    } as unknown as PortalTokenRepository
    const portalAddressRepo = createInMemoryPortalAddressRepo()
    const addressCipher = createInMemoryPortalAddressCipher()
    const context = {
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      tokenId: 'token',
      version: 1,
    }
    portalAddressRepo.store(context, {
      tokenId: 'token',
      propertyId: portal.propertyId,
      version: 1,
      issuedAt: NOW,
      sealed: addressCipher.seal('raw-code', context),
      accessArtifactIds: { qr: QR_ID, nfc: NFC_ID },
      printCodeHashes: { qr: null, nfc: null },
    })
    const deps = {
      portalRepo,
      portalTokenRepo,
      portalAddressRepo,
      addressCipher,
      staffPublicApi,
      tokenCodec: testPortalTokenCodec(),
      commandStore: {} as PortalCommandStore,
      reportPrintCodeProblem: vi.fn(),
      idGen: idSource(),
      clock: () => NOW,
      address: ADDRESS,
    }
    await expect(
      buildPortalAddressOperations({
        ...deps,
        propertyLifecycleApi: { isPropertyActive: async () => true },
      }).ensurePersonalPortalToken({ portalId: portal.id }, buildTestAuthContext()),
    ).resolves.toBeUndefined()
    expect(portalAddressRepo.sealedCount()).toBe(1)
    await expect(
      ensurePersonalPortalToken({ ...deps, addressCipher: null })(
        { portalId: portal.id },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ code: 'address_keyring_missing' })
    portalAddressRepo.clear(context)
    await expect(
      ensurePersonalPortalToken(deps)({ portalId: portal.id }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'address_keyring_missing' })
  })
})
