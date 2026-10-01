import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalTokenCodec } from '../ports/portal-token-codec.port'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createInMemoryPortalAddressRepo } from '#/shared/testing/in-memory-portal-address-repo'
import { createInMemoryPortalAddressCipher } from '#/shared/testing/in-memory-portal-address-cipher'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { unbrand } from '#/shared/domain/ids'
import { issueToken } from '../../domain/portal-token'
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

/** The portal use cases wired over the in-memory stores, with or without a cipher. */
function harness(options: Readonly<{ cipher: boolean }> = { cipher: true }) {
  const portalRepo = createInMemoryPortalRepo()
  const portal = buildTestPortal()
  portalRepo.seed([portal])
  const addressRepo = createInMemoryPortalAddressRepo()
  const addressCipher = options.cipher ? createInMemoryPortalAddressCipher() : null
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
  const tokenCodec = {
    issue: () => ({
      rawToken: raw,
      tokenIdentifier: raw.slice(3, 19),
      tokenHash: `hash-${raw.slice(3, 19)}`,
      tokenKeyVersion: 1,
    }),
  } as unknown as PortalTokenCodec
  const shared = {
    portalRepo,
    portalTokenRepo,
    staffPublicApi,
    commandStore,
    clock: () => NOW,
    baseUrl: 'https://example.test',
  }
  return {
    portal,
    deps: shared,
    addressRepo,
    ctx: buildTestAuthContext(),
    useRaw: (value: string) => {
      raw = value
    },
    issue: issuePortalToken({ ...shared, tokenCodec, idGen, addressCipher }),
    rotate: rotatePortalToken({
      ...shared,
      tokenCodec,
      idGen,
      addressCipher,
      defaultGracePeriodSeconds: 30 * 24 * 60 * 60,
    }),
    revoke: revokePortalTokens(shared),
    revealWith: (
      overrides: Partial<{
        addressRepo: PortalAddressRepository
        addressCipher: PortalAddressCipher | null
      }>,
    ) =>
      revealPortalAddress({
        portalRepo,
        staffPublicApi,
        portalAddressRepo: overrides.addressRepo ?? addressRepo,
        addressCipher:
          overrides.addressCipher === undefined ? addressCipher : overrides.addressCipher,
        clock: () => NOW,
        baseUrl: 'https://example.test',
      }),
    reveal: revealPortalAddress({
      portalRepo,
      staffPublicApi,
      portalAddressRepo: addressRepo,
      addressCipher,
      clock: () => NOW,
      baseUrl: 'https://example.test',
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
      clock: () => NOW,
      baseUrl: 'https://example.test',
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
