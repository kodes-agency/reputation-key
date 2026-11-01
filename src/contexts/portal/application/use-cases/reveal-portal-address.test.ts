import { getOwnPersonalCode } from './get-own-personal-code'
import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalAddressFormat } from '../portal-address-urls'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { PrintCodeProblem } from '../ports/print-code-reporter.port'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createInMemoryPortalAddressRepo } from '#/shared/testing/in-memory-portal-address-repo'
import { createInMemoryPortalAddressCipher } from '#/shared/testing/in-memory-portal-address-cipher'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { unbrand } from '#/shared/domain/ids'
import { issueToken } from '../../domain/portal-token'
import { portalError } from '../../domain/errors'
import { testPortalTokenCodec } from '../../infrastructure/testing/portal-token-codec-fixture'
import type { PortalAddressCipher } from '../ports/portal-address-cipher.port'
import type { PortalAddressRepository } from '../ports/portal-address.repository'
import { issuePortalToken } from './issue-portal-token'
import { revealPortalAddress } from './reveal-portal-address'
import { revokePortalTokens } from './revoke-portal-tokens'
import { rotatePortalToken } from './rotate-portal-token'

const NOW = new Date('2026-08-16T12:00:00.000Z')
const staffPublicApi = {
  getAccessiblePropertyIds: vi.fn(async () => null),
} as unknown as StaffPublicApi
const RAW = `pt_${'A'.repeat(16)}_${'b'.repeat(43)}`
const ROTATED_RAW = `pt_${'C'.repeat(16)}_${'d'.repeat(43)}`
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://example.test',
  printOrigin: 'https://ap.example.test',
  printCodesEnabled: false,
}
const SHORT: PortalAddressFormat = { ...ADDRESS, printCodesEnabled: true }

/** The portal use cases wired over the in-memory stores, with or without a cipher. */
function harness(
  options: Readonly<{ cipher?: boolean; address?: PortalAddressFormat }> = {},
) {
  const withCipher = options.cipher ?? true
  const address = options.address ?? ADDRESS
  const reported: PrintCodeProblem[] = []
  const reportPrintCodeProblem = (problem: PrintCodeProblem) => {
    reported.push(problem)
  }
  const portalRepo = createInMemoryPortalRepo()
  const portal = buildTestPortal()
  portalRepo.seed([portal])
  const addressRepo = createInMemoryPortalAddressRepo()
  const addressCipher = withCipher ? createInMemoryPortalAddressCipher() : null
  const tokens = new Map<string, ReturnType<typeof issueToken>>()
  const portalTokenRepo = {
    findLatestForPortal: vi.fn(async () => [...tokens.values()].at(-1) ?? null),
    insert: vi.fn(async (token: ReturnType<typeof issueToken>) => {
      tokens.set(token.id, token)
    }),
    saveRotation: vi.fn(
      async (input: {
        oldToken: ReturnType<typeof issueToken>
        newToken: ReturnType<typeof issueToken>
      }) => {
        tokens.set(input.oldToken.id, input.oldToken)
        tokens.set(input.newToken.id, input.newToken)
      },
    ),
    revokeForPortal: vi.fn(async () => tokens.size),
  } as unknown as PortalTokenRepository
  const commandStore = createInMemoryPortalCommandStore({
    portalRepo,
    portalTokenRepo,
    portalAddressRepo: addressRepo,
    outbox: createRecordedOutbox(),
  })
  let next = 0
  const idGen = () => `6a300000-0000-4000-8000-${String(++next).padStart(12, '0')}`
  let raw = RAW
  const tokenCodec = testPortalTokenCodec(() => raw)
  const shared = {
    portalRepo,
    portalTokenRepo,
    staffPublicApi,
    commandStore,
    clock: () => NOW,
  }
  return {
    portal,
    deps: shared,
    addressRepo,
    tokenCodec,
    reported,
    ctx: buildTestAuthContext(),
    useRaw: (value: string) => {
      raw = value
    },
    issue: issuePortalToken({
      ...shared,
      tokenCodec,
      idGen,
      addressCipher,
      reportPrintCodeProblem,
      address,
    }),
    rotate: rotatePortalToken({
      ...shared,
      tokenCodec,
      idGen,
      addressCipher,
      reportPrintCodeProblem,
      address,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    }),
    revoke: revokePortalTokens(shared),
    revealWith: (
      overrides: Partial<{
        addressRepo: PortalAddressRepository
        addressCipher: PortalAddressCipher | null
        tokenCodec: Pick<PortalTokenCodec, 'derivePrintCodes'>
      }>,
    ) =>
      revealPortalAddress({
        portalRepo,
        staffPublicApi,
        portalAddressRepo: overrides.addressRepo ?? addressRepo,
        addressCipher:
          overrides.addressCipher === undefined ? addressCipher : overrides.addressCipher,
        tokenCodec: overrides.tokenCodec ?? tokenCodec,
        reportPrintCodeProblem,
        clock: () => NOW,
        address,
      }),
    ownCode: (assigned = true) =>
      getOwnPersonalCode({
        portalRepo,
        staffPublicApi: {
          getAccessiblePropertyIds: async () => [],
          getAssignedPortals: async () => (assigned ? [portal.id] : []),
        },
        portalAddressRepo: addressRepo,
        addressCipher,
        tokenCodec,
        reportPrintCodeProblem,
        clock: () => NOW,
        address,
        propertyLifecycleApi: { isPropertyActive: async () => true },
      }),
    reveal: revealPortalAddress({
      portalRepo,
      staffPublicApi,
      portalAddressRepo: addressRepo,
      addressCipher,
      tokenCodec,
      reportPrintCodeProblem,
      clock: () => NOW,
      address,
    }),
  }
}

describe('revealPortalAddress', () => {
  it('hands the manager the same two addresses the code was made with, and records it first', async () => {
    const h = harness()
    const issued = await h.issue({ portalId: h.portal.id }, h.ctx)

    const revealed = await h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(revealed.publicUrls).toEqual(issued.publicUrls)
    expect(revealed.publicUrl).toBe(issued.publicUrl)
    expect(revealed.version).toBe(issued.version)
    expect(h.addressRepo.downloads()).toEqual([
      expect.objectContaining({
        organizationId: unbrand(h.ctx.organizationId),
        portalId: unbrand(h.portal.id),
        downloadedBy: unbrand(h.ctx.userId),
        purpose: 'download',
        at: NOW,
      }),
    ])
  })

  it('records the disclosure before it decrypts anything', async () => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const inner = createInMemoryPortalAddressCipher()
    const rowsWhenOpened: number[] = []
    const reveal = h.revealWith({
      addressCipher: {
        ...inner,
        open: (sealed, context) => {
          rowsWhenOpened.push(h.addressRepo.downloads().length)
          return inner.open(sealed, context)
        },
      },
    })

    await reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(rowsWhenOpened).toEqual([1])
  })

  it('does not decrypt when the disclosure row is refused (the code was stopped meanwhile)', async () => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const sealed = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    const inner = createInMemoryPortalAddressCipher()
    const open = vi.fn(inner.open)
    const reveal = h.revealWith({
      addressRepo: {
        findRevealable: async () => sealed,
        recordDownload: async () => false,
        fillPrintCodeHashes: async () => null,
      },
      addressCipher: { ...inner, open },
    })

    await expect(
      reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx),
    ).rejects.toMatchObject({ code: 'address_unavailable' })
    expect(open).not.toHaveBeenCalled()
  })

  it.each(['copy', 'show'] as const)('records a %s as that purpose', async (purpose) => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    await h.reveal({ portalId: h.portal.id, purpose }, h.ctx)
    expect(h.addressRepo.downloads()[0]?.purpose).toBe(purpose)
  })

  it('does not write the audit row when it cannot disclose', async () => {
    const h = harness({ cipher: false })
    await h.issue({ portalId: h.portal.id }, h.ctx)

    await expect(
      h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx),
    ).rejects.toMatchObject({ code: 'address_unavailable' })
    expect(h.addressRepo.downloads()).toEqual([])
  })

  it('keeps no sealed address for a code made without a keyring', async () => {
    const h = harness({ cipher: false })
    await h.issue({ portalId: h.portal.id }, h.ctx)
    expect(h.addressRepo.sealedCount()).toBe(0)
  })

  it('does not disclose, or record, when the key that sealed the code was retired', async () => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const retired = revealPortalAddress({
      portalRepo: h.deps.portalRepo,
      staffPublicApi,
      portalAddressRepo: h.addressRepo,
      addressCipher: createInMemoryPortalAddressCipher({ activeKeyVersion: 2 }),
      tokenCodec: h.tokenCodec,
      reportPrintCodeProblem: () => undefined,
      clock: () => NOW,
      address: ADDRESS,
    })

    await expect(
      retired({ portalId: h.portal.id, purpose: 'download' }, h.ctx),
    ).rejects.toMatchObject({ code: 'address_unavailable' })
    expect(h.addressRepo.downloads()).toEqual([])
  })

  it('refuses a Portal with no code', async () => {
    const h = harness()
    await expect(
      h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx),
    ).rejects.toMatchObject({ code: 'address_unavailable' })
    expect(h.addressRepo.downloads()).toEqual([])
  })

  it('needs permission to manage the Portal', async () => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    await expect(
      h.reveal(
        { portalId: h.portal.id, purpose: 'download' },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(h.addressRepo.downloads()).toEqual([])
  })

  it("does not find another organization's Portal", async () => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    await expect(
      h.reveal(
        { portalId: h.portal.id, purpose: 'download' },
        buildTestAuthContext({
          organizationId: 'org-00000000-0000-0000-0000-0000000000ff' as never,
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })

  it('serves only the newest code after a replacement, and clears the old one', async () => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    h.useRaw(ROTATED_RAW)
    const first = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    const rotated = await h.rotate({ portalId: h.portal.id }, h.ctx)
    const second = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)

    expect(h.addressRepo.sealedCount()).toBe(1)
    expect(second?.tokenId).not.toBe(first?.tokenId)

    const revealed = await h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(revealed.publicUrls).toEqual(rotated.publicUrls)
    expect(revealed.publicUrl).toContain(ROTATED_RAW)
    expect(revealed.version).toBe(2)
  })

  it('serves nothing once every code is stopped', async () => {
    const h = harness()
    await h.issue({ portalId: h.portal.id }, h.ctx)
    await h.revoke({ portalId: h.portal.id, reason: 'leaked' }, h.ctx)

    await expect(
      h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx),
    ).rejects.toMatchObject({ code: 'address_unavailable' })
    expect(h.addressRepo.sealedCount()).toBe(0)
  })
})

describe('revealPortalAddress — print codes (ADR 0069)', () => {
  const SCOPE = (h: ReturnType<typeof harness>) => ({
    organizationId: unbrand(h.ctx.organizationId),
    portalId: unbrand(h.portal.id),
  })

  /** A repository over the in-memory one that answers `fill` as the test says, and counts how often it was asked. */
  function withFill(
    h: ReturnType<typeof harness>,
    fill: PortalAddressRepository['fillPrintCodeHashes'],
  ) {
    const asked = vi.fn(fill)
    const repo: PortalAddressRepository = {
      findRevealable: h.addressRepo.findRevealable,
      recordDownload: h.addressRepo.recordDownload,
      fillPrintCodeHashes: asked,
    }
    return { repo, asked }
  }

  it('hands back the short addresses the code was made with, with nothing to fill', async () => {
    const h = harness({ address: SHORT })
    const issued = await h.issue({ portalId: h.portal.id }, h.ctx)
    const { repo, asked } = withFill(h, h.addressRepo.fillPrintCodeHashes)

    const revealed = await h.revealWith({ addressRepo: repo })(
      { portalId: h.portal.id, purpose: 'download' },
      h.ctx,
    )

    expect(revealed.publicUrls).toEqual(issued.publicUrls)
    expect(revealed.publicUrl).toMatch(/^HTTPS:\/\/AP\.EXAMPLE\.TEST\/p\/[0-9A-Z]{20}$/u)
    expect(revealed.publicUrls.direct).toBe(`https://example.test/p/${RAW}`)
    expect(asked).not.toHaveBeenCalled()
    expect(h.reported).toEqual([])
  })

  it('fills the hashes a code made before print codes lacks, then hands back the short form', async () => {
    const h = harness({ address: SHORT })
    const issued = await h.issue({ portalId: h.portal.id }, h.ctx)
    const live = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    if (live === null) throw new Error('the code was not sealed')
    h.addressRepo.store(SCOPE(h), { ...live, printCodeHashes: { qr: null, nfc: null } })
    expect(h.addressRepo.printCodeHashesOf(SCOPE(h))).toEqual({ qr: null, nfc: null })

    const revealed = await h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(revealed.publicUrls).toEqual(issued.publicUrls)
    expect(h.addressRepo.printCodeHashesOf(SCOPE(h))).toEqual({
      qr: expect.stringMatching(/^[0-9a-f]{64}$/u),
      nfc: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(h.reported).toEqual([])
  })

  it('fills only once: a second reveal finds both hashes and writes nothing', async () => {
    const h = harness({ address: SHORT })
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const live = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    if (live === null) throw new Error('the code was not sealed')
    h.addressRepo.store(SCOPE(h), { ...live, printCodeHashes: { qr: null, nfc: null } })
    const { repo, asked } = withFill(h, h.addressRepo.fillPrintCodeHashes)
    const reveal = h.revealWith({ addressRepo: repo })

    const first = await reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)
    const second = await reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(second.publicUrls).toEqual(first.publicUrls)
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('fills a code but still shows the long address while the short one is switched off', async () => {
    const h = harness({ address: ADDRESS })
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const live = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    if (live === null) throw new Error('the code was not sealed')
    h.addressRepo.store(SCOPE(h), { ...live, printCodeHashes: { qr: null, nfc: null } })

    const revealed = await h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
    expect(revealed.publicUrls.nfc).toContain('?accessArtifact=')
    expect(h.addressRepo.printCodeHashesOf(SCOPE(h))?.qr).not.toBeNull()
  })

  it('falls back to the long address for a channel whose stored hash differs, and reports it once', async () => {
    const h = harness({ address: SHORT })
    const issued = await h.issue({ portalId: h.portal.id }, h.ctx)
    const live = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    if (live === null) throw new Error('the code was not sealed')
    h.addressRepo.store(SCOPE(h), {
      ...live,
      printCodeHashes: { qr: 'f'.repeat(64), nfc: live.printCodeHashes.nfc },
    })

    const revealed = await h.reveal({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(revealed.publicUrls.qr).toBe(
      `https://example.test/p/${RAW}?accessArtifact=${live.accessArtifactIds.qr}`,
    )
    expect(revealed.publicUrls.nfc).toBe(issued.publicUrls.nfc)
    expect(revealed.publicUrls.nfc).toMatch(/^https:\/\/ap\.example\.test\/p\//u)
    expect(h.reported).toEqual(['derive_mismatch'])
  })

  it('never fails the reveal when a missing hash cannot be stored, and reports why', async () => {
    const h = harness({ address: SHORT })
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const live = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    if (live === null) throw new Error('the code was not sealed')
    h.addressRepo.store(SCOPE(h), { ...live, printCodeHashes: { qr: null, nfc: null } })
    const { repo } = withFill(h, async () => {
      throw new Error('lock timeout')
    })

    const revealed = await h.revealWith({ addressRepo: repo })(
      { portalId: h.portal.id, purpose: 'download' },
      h.ctx,
    )

    expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
    expect(revealed.publicUrls.nfc).toContain('?accessArtifact=')
    expect(h.reported).toEqual(['fill_failed'])
    expect(h.addressRepo.downloads()).toHaveLength(1)
  })

  it('reports a unique violation on the fill as a collision', async () => {
    const h = harness({ address: SHORT })
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const live = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    if (live === null) throw new Error('the code was not sealed')
    h.addressRepo.store(SCOPE(h), { ...live, printCodeHashes: { qr: null, nfc: null } })
    const { repo } = withFill(h, async () => {
      throw portalError('print_code_collision', 'The new code could not be saved.')
    })

    const revealed = await h.revealWith({ addressRepo: repo })(
      { portalId: h.portal.id, purpose: 'download' },
      h.ctx,
    )

    expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
    expect(h.reported).toEqual(['collision'])
  })

  it('shows the long address without a report when the code stopped between the read and the fill', async () => {
    const h = harness({ address: SHORT })
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const live = await h.addressRepo.findRevealable(h.ctx.organizationId, h.portal.id)
    if (live === null) throw new Error('the code was not sealed')
    h.addressRepo.store(SCOPE(h), { ...live, printCodeHashes: { qr: null, nfc: null } })
    const { repo } = withFill(h, async () => null)

    const revealed = await h.revealWith({ addressRepo: repo })(
      { portalId: h.portal.id, purpose: 'download' },
      h.ctx,
    )

    expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
    expect(h.reported).toEqual([])
  })

  it('falls back to the long address and reports it when the print codes cannot be derived at all', async () => {
    const h = harness({ address: SHORT })
    await h.issue({ portalId: h.portal.id }, h.ctx)

    const revealed = await h.revealWith({
      tokenCodec: { derivePrintCodes: () => null },
    })({ portalId: h.portal.id, purpose: 'download' }, h.ctx)

    expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
    expect(revealed.publicUrls.nfc).toContain('?accessArtifact=')
    expect(h.reported).toEqual(['derive_mismatch'])
  })
})

describe('getOwnPersonalCode', () => {
  it('shows paused after revocation without suggesting that staff replace the code', async () => {
    const h = harness()
    h.deps.portalRepo.seed([{ ...h.portal, kind: 'personal', publicName: 'Harbor' }])
    await h.issue({ portalId: h.portal.id }, h.ctx)
    await h.revoke({ portalId: h.portal.id, reason: 'leaked' }, h.ctx)
    expect(
      await h.ownCode()(
        { portalId: h.portal.id },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).toEqual({ state: 'paused' })
    expect(h.addressRepo.downloads()).toEqual([])
  })
  it('reads only QR for a Member and audits once per token version, refreshing after replacement', async () => {
    const h = harness({ address: SHORT })
    h.deps.portalRepo.seed([{ ...h.portal, kind: 'personal', publicName: 'Harbor' }])
    await h.issue({ portalId: h.portal.id }, h.ctx)
    const member = buildTestAuthContext({ role: 'Member' })
    const first = await h.ownCode()({ portalId: h.portal.id }, member)
    expect(Object.keys(first).sort()).toEqual(['qr', 'state', 'wordingKey'])
    await h.ownCode()({ portalId: h.portal.id }, member)
    expect(h.addressRepo.downloads()).toHaveLength(1)
    h.useRaw(ROTATED_RAW)
    await h.rotate({ portalId: h.portal.id, replacementKind: 'security' }, h.ctx)
    const next = await h.ownCode()({ portalId: h.portal.id }, member)
    expect(next).not.toEqual(first)
    expect(h.addressRepo.downloads()).toHaveLength(2)
  })
  it('refuses a Portal that is not the caller personal assignment', async () => {
    const h = harness()
    h.deps.portalRepo.seed([{ ...h.portal, kind: 'personal', publicName: 'Harbor' }])
    await expect(
      h.ownCode(false)(
        { portalId: h.portal.id },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
