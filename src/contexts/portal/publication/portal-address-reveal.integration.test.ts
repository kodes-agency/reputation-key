// "Download again" and a staff member's own code on real PostgreSQL, with two
// organizations: the disclosure row written before anything is decrypted, the
// refusals that write none, the newest code served after a replacement, and the
// print codes the reveal vouches for. The real use cases run over the real
// stores, cipher and codec; only the clock is fixed, and a few tests watch or
// interrupt one collaborator.

import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { PortalAddressFormat } from '../application/portal-address-urls'
import type { PortalAddressCipher } from '../application/ports/portal-address-cipher.port'
import type { PortalAddressRepository } from '../application/ports/portal-address.repository'
import type { PortalTokenCodec } from '../application/ports/portal-token-codec.port'
import type { PrintCodeProblem } from '../application/ports/print-code-reporter.port'
import { getOwnPersonalCode } from '../application/use-cases/get-own-personal-code'
import { issuePortalToken } from '../application/use-cases/issue-portal-token'
import { revealPortalAddress } from '../application/use-cases/reveal-portal-address'
import { revokePortalTokens } from '../application/use-cases/revoke-portal-tokens'
import { rotatePortalToken } from '../application/use-cases/rotate-portal-token'
import { createPortalAddressCipher } from '../infrastructure/adapters/portal-address-cipher'
import { createPortalAddressRepository } from '../infrastructure/repositories/portal-address.repository'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import { seedClusterPortal } from '../infrastructure/testing/portal-token-cluster-fixtures'
import { testPortalTokenCodec } from '../infrastructure/testing/portal-token-codec-fixture'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-address-reveal-000000000001')
const ORG_B = organizationId('org-address-reveal-000000000002')
const NOW = new Date('2026-08-16T12:00:00.000Z')
const KEYRING = `1:${'ab'.repeat(32)}`
const RETIRED_KEYRING = `2:${'cd'.repeat(32)}`
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://example.test',
  printOrigin: 'https://ap.example.test',
}

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_address_downloads',
    'portal_access_artifacts',
    'portal_tokens',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const cipherOf = (keyring: string) =>
  createPortalAddressCipher({ keyring, generateIv: () => randomBytes(12) })

const seedPortal = (
  org: string,
  options: Readonly<{ kind?: 'place' | 'personal' }> = {},
) => seedClusterPortal(getPool(), org, { ...options, updatedAt: NOW })

type Wiring = Readonly<{
  keyring?: boolean
  assigned?: readonly string[]
}>

type Overrides = Partial<{
  addressRepo: PortalAddressRepository
  addressCipher: PortalAddressCipher | null
  tokenCodec: Pick<PortalTokenCodec, 'derivePrintCodes'>
}>

function wire(options: Wiring = {}) {
  const db = getDb()
  const reported: PrintCodeProblem[] = []
  const reportPrintCodeProblem = (problem: PrintCodeProblem) => {
    reported.push(problem)
  }
  const addressCipher = options.keyring === false ? null : cipherOf(KEYRING)
  const staffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [...(options.assigned ?? [])],
  } as unknown as StaffPublicApi
  const portalRepo = createPortalRepository(db)
  const portalAddressRepo = createPortalAddressRepository(db)
  const tokenCodec = testPortalTokenCodec()
  const common = {
    portalRepo,
    portalTokenRepo: createPortalTokenRepository(db),
    staffPublicApi,
    commandStore: createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
    tokenCodec,
    addressCipher,
    reportPrintCodeProblem,
    idGen: randomUUID,
    clock: () => NOW,
    address: ADDRESS,
  }
  const revealDeps = {
    portalRepo,
    staffPublicApi,
    portalAddressRepo,
    addressCipher,
    tokenCodec,
    reportPrintCodeProblem,
    clock: () => NOW,
    address: ADDRESS,
  }
  return {
    reported,
    portalAddressRepo,
    issue: issuePortalToken(common),
    rotate: rotatePortalToken({ ...common, defaultGracePeriodSeconds: 30 * 86_400 }),
    revoke: revokePortalTokens(common),
    reveal: revealPortalAddress(revealDeps),
    revealWith: (overrides: Overrides) =>
      revealPortalAddress({
        ...revealDeps,
        portalAddressRepo: overrides.addressRepo ?? portalAddressRepo,
        addressCipher:
          overrides.addressCipher === undefined ? addressCipher : overrides.addressCipher,
        tokenCodec: overrides.tokenCodec ?? tokenCodec,
      }),
    ownCode: getOwnPersonalCode({
      ...revealDeps,
      publicationRepo: { findActiveForPortal: async () => null },
      experienceRepo: {
        getPropertyExperience: async () => ({ profile: null, content: [] }),
      },
      mediaRepo: { findById: async () => null },
      mediaUrls: async () => ({}),
      wordingRepo: { find: async () => null },
      lastPrintRepo: { find: async () => null },
      propertyLifecycleApi: { isPropertyActive: async () => true },
    }),
  }
}

const ctxOf = (org: string, role: 'PropertyManager' | 'Member' = 'PropertyManager') =>
  buildTestAuthContext({ organizationId: organizationId(org), role })

const downloadsOf = async (org: string) =>
  (
    await getPool().query<{
      organization_id: string
      portal_id: string
      portal_token_id: string
      downloaded_by: string
      purpose: string
      downloaded_at: Date
    }>(
      `SELECT organization_id, portal_id, portal_token_id, downloaded_by, purpose,
              downloaded_at
       FROM portal_address_downloads WHERE organization_id = $1
       ORDER BY downloaded_at, id`,
      [org],
    )
  ).rows

const sealedCount = async (portal: Readonly<{ id: string }>) =>
  Number(
    (
      await getPool().query<{ n: string }>(
        `SELECT count(*) AS n FROM portal_tokens
         WHERE portal_id = $1 AND encrypted_raw_token IS NOT NULL`,
        [portal.id],
      )
    ).rows[0]?.n,
  )

const tokenIdOf = async (portal: Readonly<{ id: string }>) =>
  (
    await getPool().query<{ id: string }>(
      'SELECT id FROM portal_tokens WHERE portal_id = $1 ORDER BY version DESC',
      [portal.id],
    )
  ).rows[0]?.id

const forgetHashes = (portal: Readonly<{ id: string }>) =>
  getPool().query(
    `UPDATE portal_tokens SET qr_print_code_hash = NULL, nfc_print_code_hash = NULL
     WHERE portal_id = $1`,
    [portal.id],
  )

const unavailable = { code: 'address_unavailable' }

describe.sequential('revealing the address (real PostgreSQL, two tenants)', () => {
  it('hands the manager the same two addresses the code was made with, and records it first', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, reveal } = wire()
    const issued = await issue({ portalId: portal.id }, ctx)

    const revealed = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

    expect(revealed.publicUrls).toEqual(issued.publicUrls)
    expect(revealed.publicUrl).toBe(issued.publicUrl)
    expect(revealed.version).toBe(issued.version)
    expect(await downloadsOf(ORG_A)).toEqual([
      {
        organization_id: ORG_A,
        portal_id: portal.id,
        portal_token_id: await tokenIdOf(portal),
        downloaded_by: ctx.userId,
        purpose: 'download',
        downloaded_at: NOW,
      },
    ])
    expect(await downloadsOf(ORG_B)).toEqual([])
  })

  it('records the disclosure before it decrypts anything', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, revealWith, portalAddressRepo } = wire()
    await issue({ portalId: portal.id }, ctx)
    const inner = cipherOf(KEYRING)
    let recorded = false
    const recordedWhenOpened: boolean[] = []
    const reveal = revealWith({
      addressRepo: {
        ...portalAddressRepo,
        recordDownload: async (input) => {
          const written = await portalAddressRepo.recordDownload(input)
          recorded = written
          return written
        },
      },
      addressCipher: {
        ...inner,
        open: (sealed, context) => {
          recordedWhenOpened.push(recorded)
          return inner.open(sealed, context)
        },
      },
    })

    await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

    expect(recordedWhenOpened).toEqual([true])
    expect(await downloadsOf(ORG_A)).toHaveLength(1)
  })

  it('does not decrypt when the disclosure row is refused (the code was stopped meanwhile)', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, revoke, revealWith, portalAddressRepo } = wire()
    await issue({ portalId: portal.id }, ctx)
    const sealed = await portalAddressRepo.findRevealable(ORG_A, portal.id)
    await revoke({ portalId: portal.id, reason: 'leaked' }, ctx)
    const inner = cipherOf(KEYRING)
    const open = vi.fn(inner.open)
    const reveal = revealWith({
      addressRepo: { ...portalAddressRepo, findRevealable: async () => sealed },
      addressCipher: { ...inner, open },
    })

    await expect(
      reveal({ portalId: portal.id, purpose: 'download' }, ctx),
    ).rejects.toMatchObject(unavailable)
    expect(open).not.toHaveBeenCalled()
    expect(await downloadsOf(ORG_A)).toEqual([])
  })

  it.each(['copy', 'show'] as const)('records a %s as that purpose', async (purpose) => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, reveal } = wire()
    await issue({ portalId: portal.id }, ctx)

    await reveal({ portalId: portal.id, purpose }, ctx)

    expect((await downloadsOf(ORG_A)).map((row) => row.purpose)).toEqual([purpose])
  })

  it('does not write the audit row when it cannot disclose, and keeps no sealed address without a keyring', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, reveal } = wire({ keyring: false })
    await issue({ portalId: portal.id }, ctx)

    await expect(
      reveal({ portalId: portal.id, purpose: 'download' }, ctx),
    ).rejects.toMatchObject(unavailable)
    expect(await downloadsOf(ORG_A)).toEqual([])
    expect(await sealedCount(portal)).toBe(0)
  })

  it('does not disclose, or record, when the key that sealed the code was retired', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, revealWith } = wire()
    await issue({ portalId: portal.id }, ctx)
    const retired = revealWith({ addressCipher: cipherOf(RETIRED_KEYRING) })

    await expect(
      retired({ portalId: portal.id, purpose: 'download' }, ctx),
    ).rejects.toMatchObject(unavailable)
    expect(await downloadsOf(ORG_A)).toEqual([])
  })

  it('refuses a Portal with no code', async () => {
    const portal = await seedPortal(ORG_A)
    const { reveal } = wire()

    await expect(
      reveal({ portalId: portal.id, purpose: 'download' }, ctxOf(ORG_A)),
    ).rejects.toMatchObject(unavailable)
    expect(await downloadsOf(ORG_A)).toEqual([])
  })

  it('needs permission to manage the Portal', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, reveal } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))

    await expect(
      reveal({ portalId: portal.id, purpose: 'download' }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await downloadsOf(ORG_A)).toEqual([])
  })

  it("does not find another organization's Portal, and discloses nothing to it", async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, reveal } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))

    await expect(
      reveal({ portalId: portal.id, purpose: 'download' }, ctxOf(ORG_B)),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect(await downloadsOf(ORG_A)).toEqual([])
    expect(await downloadsOf(ORG_B)).toEqual([])
  })

  it('serves only the newest code after a replacement, and clears the old one', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, rotate, reveal } = wire()
    const first = await issue({ portalId: portal.id }, ctx)
    const rotated = await rotate({ portalId: portal.id }, ctx)

    const revealed = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

    expect(await sealedCount(portal)).toBe(1)
    expect(revealed.publicUrls).toEqual(rotated.publicUrls)
    expect(revealed.publicUrls.direct).toContain(rotated.rawToken)
    expect(revealed.publicUrls.direct).not.toContain(first.rawToken)
    expect(revealed.version).toBe(2)
  })

  it('serves nothing once every code is stopped', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, revoke, reveal } = wire()
    await issue({ portalId: portal.id }, ctx)
    await revoke({ portalId: portal.id, reason: 'leaked' }, ctx)

    await expect(
      reveal({ portalId: portal.id, purpose: 'download' }, ctx),
    ).rejects.toMatchObject(unavailable)
    expect(await downloadsOf(ORG_A)).toEqual([])
  })
})

describe.sequential('revealing vouches for the print codes (real PostgreSQL)', () => {
  it('fills only once: a second reveal finds both hashes and writes nothing', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, revealWith, portalAddressRepo } = wire()
    await issue({ portalId: portal.id }, ctx)
    await forgetHashes(portal)
    const asked = vi.fn(portalAddressRepo.fillPrintCodeHashes)
    const reveal = revealWith({
      addressRepo: { ...portalAddressRepo, fillPrintCodeHashes: asked },
    })

    const first = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)
    const second = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

    expect(second.publicUrls).toEqual(first.publicUrls)
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('shows the long address without a report when the code stopped between the read and the fill', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, revoke, revealWith, portalAddressRepo, reported } = wire()
    await issue({ portalId: portal.id }, ctx)
    await forgetHashes(portal)
    const reveal = revealWith({
      addressRepo: {
        ...portalAddressRepo,
        fillPrintCodeHashes: async (input) => {
          await revoke({ portalId: portal.id, reason: 'stopped' }, ctx)
          return portalAddressRepo.fillPrintCodeHashes(input)
        },
      },
    })

    const revealed = await reveal({ portalId: portal.id, purpose: 'download' }, ctx)

    expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
    expect(revealed.publicUrls.nfc).toContain('?accessArtifact=')
    expect(reported).toEqual([])
  })

  it('falls back to the long address and reports it when the print codes cannot be derived at all', async () => {
    const portal = await seedPortal(ORG_A)
    const ctx = ctxOf(ORG_A)
    const { issue, revealWith, reported } = wire()
    await issue({ portalId: portal.id }, ctx)

    const revealed = await revealWith({ tokenCodec: { derivePrintCodes: () => null } })(
      { portalId: portal.id, purpose: 'download' },
      ctx,
    )

    expect(revealed.publicUrls.qr).toContain('?accessArtifact=')
    expect(revealed.publicUrls.nfc).toContain('?accessArtifact=')
    expect(reported).toEqual(['derive_mismatch'])
  })
})

describe.sequential("a staff member's own code (real PostgreSQL, two tenants)", () => {
  const member = (org: string) => ctxOf(org, 'Member')

  it('shows paused after revocation without suggesting that staff replace the code', async () => {
    const portal = await seedPortal(ORG_A, { kind: 'personal' })
    const { issue, revoke, ownCode: own } = wire({ assigned: [portal.id] })
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    await revoke({ portalId: portal.id, reason: 'leaked' }, ctxOf(ORG_A))

    expect(await own({ portalId: portal.id }, member(ORG_A))).toEqual({ state: 'paused' })
    expect(await downloadsOf(ORG_A)).toEqual([])
  })

  it('reads only QR for a Member and audits once per token version, refreshing after replacement', async () => {
    const portal = await seedPortal(ORG_A, { kind: 'personal' })
    const { issue, rotate, ownCode: own } = wire({ assigned: [portal.id] })
    await issue({ portalId: portal.id }, ctxOf(ORG_A))

    const first = await own({ portalId: portal.id }, member(ORG_A))
    expect(Object.keys(first).sort()).toEqual([
      'cue',
      'headline',
      'qr',
      'state',
      'subline',
      'wordingKey',
    ])
    await own({ portalId: portal.id }, member(ORG_A))
    expect(await downloadsOf(ORG_A)).toHaveLength(1)

    await rotate({ portalId: portal.id, replacementKind: 'security' }, ctxOf(ORG_A))
    const next = await own({ portalId: portal.id }, member(ORG_A))

    expect(next).not.toEqual(first)
    expect((await downloadsOf(ORG_A)).map((row) => row.purpose)).toEqual(['show', 'show'])
  })

  it('refuses a Portal that is not the caller personal assignment, in any organization', async () => {
    const portal = await seedPortal(ORG_A, { kind: 'personal' })
    const { issue, ownCode } = wire({ assigned: [] })
    await issue({ portalId: portal.id }, ctxOf(ORG_A))

    await expect(ownCode({ portalId: portal.id }, member(ORG_A))).rejects.toMatchObject({
      code: 'forbidden',
    })
    const other = wire({ assigned: [portal.id] }).ownCode
    await expect(other({ portalId: portal.id }, member(ORG_B))).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(await downloadsOf(ORG_A)).toEqual([])
    expect(await downloadsOf(ORG_B)).toEqual([])
  })
})
