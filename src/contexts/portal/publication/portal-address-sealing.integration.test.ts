// Issuing and replacing a Portal's code with address recovery on real
// PostgreSQL, with two organizations: the facts recorded at the Portal's
// revision, the address sealed for its own row, the replacement window refusals
// and the staff code checkpoint retry. The real use cases run over the real
// stores, cipher, codec and command store; only the clock is fixed.

import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildPortalAddressOperations } from '../build-address-operations'
import type { PortalAddressFormat } from '../application/portal-address-urls'
import type { PrintCodeProblem } from '../application/ports/print-code-reporter.port'
import { issuePortalToken } from '../application/use-cases/issue-portal-token'
import { rotatePortalToken } from '../application/use-cases/rotate-portal-token'
import {
  createPortalAddressCipher,
  PortalAddressCipherError,
} from '../infrastructure/adapters/portal-address-cipher'
import { createPortalAddressRepository } from '../infrastructure/repositories/portal-address.repository'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import { seedClusterPortal } from '../infrastructure/testing/portal-token-cluster-fixtures'
import { testPortalTokenCodec } from '../infrastructure/testing/portal-token-codec-fixture'
import type { PortalCommandStore } from './portal-command-store-port.server'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-address-sealing-00000000001')
const ORG_B = organizationId('org-address-sealing-00000000002')
const NOW = new Date('2026-08-16T12:00:00.000Z')
const CURRENT_REVISION = new Date('2026-08-20T12:00:00.000Z')
const NEXT_REVISION = new Date(CURRENT_REVISION.getTime() + 1)
const DAY = 24 * 60 * 60 * 1000
const KEYRING = `1:${'ab'.repeat(32)}`
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://example.test',
  printOrigin: 'https://ap.example.test',
}
const staffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
} as unknown as StaffPublicApi

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

const cipher = createPortalAddressCipher({
  keyring: KEYRING,
  generateIv: () => randomBytes(12),
})

const seedPortal = (
  org: string,
  options: Readonly<{ kind?: 'place' | 'personal' }> = {},
) => seedClusterPortal(getPool(), org, { ...options, updatedAt: CURRENT_REVISION })

type Wiring = Readonly<{
  keyring?: boolean
  commandStore?: (inner: PortalCommandStore) => PortalCommandStore
}>

function wire(options: Wiring = {}) {
  const db = getDb()
  const reported: PrintCodeProblem[] = []
  const addressCipher = options.keyring === false ? null : cipher
  const inner = createAtomicPortalCommandStore(db, createPortalRatingGoalGuard())
  const portalAddressRepo = createPortalAddressRepository(db)
  const common = {
    portalRepo: createPortalRepository(db),
    portalTokenRepo: createPortalTokenRepository(db),
    staffPublicApi,
    commandStore: options.commandStore ? options.commandStore(inner) : inner,
    tokenCodec: testPortalTokenCodec(),
    addressCipher,
    reportPrintCodeProblem: (problem: PrintCodeProblem) => {
      reported.push(problem)
    },
    idGen: randomUUID,
    clock: () => NOW,
    address: ADDRESS,
  }
  return {
    reported,
    portalAddressRepo,
    issue: issuePortalToken(common),
    rotate: rotatePortalToken({
      ...common,
      defaultGracePeriodSeconds: (30 * DAY) / 1000,
    }),
    ensure: (ctx: ReturnType<typeof ctxOf>, id: string) =>
      buildPortalAddressOperations({
        ...common,
        portalAddressRepo,
        publicationRepo: { findActiveForPortal: async () => null },
        experienceRepo: {
          getPropertyExperience: async () => ({ profile: null, content: [] }),
        },
        mediaRepo: { findById: async () => null },
        mediaUrls: async () => ({}),
        wordingRepo: { find: async () => null },
        lastPrintRepo: { find: async () => null },
        propertyLifecycleApi: { isPropertyActive: async () => true },
      }).ensurePersonalPortalToken({ portalId: id }, ctx),
  }
}

const ctxOf = (org: string, role: 'PropertyManager' | 'Member' = 'PropertyManager') =>
  buildTestAuthContext({ organizationId: organizationId(org), role })

type TokenRow = Readonly<{
  id: string
  property_id: string
  status: string
  version: number
  token_hash: string
  print_batch: string | null
  sealed: string | null
  key_version: number | null
}>

const tokensOf = async (portal: Readonly<{ id: string }>) =>
  (
    await getPool().query<TokenRow>(
      `SELECT id, property_id, status, version, token_hash, print_batch,
              encrypted_raw_token AS sealed,
              address_encryption_key_version AS key_version
       FROM portal_tokens WHERE portal_id = $1 ORDER BY version`,
      [portal.id],
    )
  ).rows

const factsOf = async (org: string, tag: string) =>
  (
    await getPool().query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = $2`,
      [org, tag],
    )
  ).rows.map((row) => row.payload)

const artifactsOf = async (portal: Readonly<{ id: string }>) =>
  (
    await getPool().query<{ id: string; channel: string; portal_token_id: string }>(
      `SELECT id, channel, portal_token_id FROM portal_access_artifacts
       WHERE portal_id = $1`,
      [portal.id],
    )
  ).rows

const revisionOf = async (portal: Readonly<{ id: string }>) =>
  (
    await getPool().query<{ updated_at: Date }>(
      'SELECT updated_at FROM portals WHERE id = $1',
      [portal.id],
    )
  ).rows[0]?.updated_at

describe.sequential('issuing a code (real PostgreSQL, two tenants)', () => {
  it('persists a tenant-bound token, records its facts at the next Portal revision and returns only public material', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue } = wire({ keyring: false })

    const issued = await issue({ portalId: portal.id }, ctxOf(ORG_A))

    expect(Object.keys(issued).sort()).toEqual([
      'addressRecoverable',
      'issuedAt',
      'publicUrl',
      'publicUrls',
      'rawToken',
      'tokenIdentifier',
      'version',
    ])
    expect(issued.publicUrl).toBe(issued.publicUrls.qr)
    const [token] = await tokensOf(portal)
    expect(token).toMatchObject({
      property_id: portal.propertyId,
      status: 'active',
      version: 1,
      print_batch: null,
    })
    expect(token?.token_hash).toMatch(/^[0-9a-f]{64}$/u)
    expect(JSON.stringify(token)).not.toContain(issued.rawToken)

    expect(await factsOf(ORG_A, 'portal.token.issued')).toEqual([
      expect.objectContaining({ sourceAggregateVersion: NEXT_REVISION.toISOString() }),
    ])
    const published = await factsOf(ORG_A, 'portal.access_artifact.published')
    const artifacts = await artifactsOf(portal)
    for (const channel of ['qr', 'nfc']) {
      const marker = artifacts.find((row) => row.channel === channel)
      expect(published).toContainEqual(
        expect.objectContaining({
          accessArtifactId: marker?.id,
          portalId: portal.id,
          channel,
          sourceAggregateVersion: NEXT_REVISION.toISOString(),
        }),
      )
    }
    expect(published).toHaveLength(2)
    expect(await revisionOf(portal)).toEqual(NEXT_REVISION)
  })

  it('seals the address for the new token under its own row, readable by no other scope or organization', async () => {
    const portalA = await seedPortal(ORG_A)
    const portalB = await seedPortal(ORG_B)
    const { issue, portalAddressRepo } = wire()

    const issued = await issue({ portalId: portalA.id }, ctxOf(ORG_A))
    await issue({ portalId: portalB.id }, ctxOf(ORG_B))

    expect(issued.addressRecoverable).toBe(true)
    const [token] = await tokensOf(portalA)
    const sealed = await portalAddressRepo.findRevealable(ORG_A, portalA.id)
    const markers = await artifactsOf(portalA)
    expect(sealed).toMatchObject({
      tokenId: token?.id,
      version: 1,
      sealed: { keyVersion: 1 },
      accessArtifactIds: {
        qr: markers.find((row) => row.channel === 'qr')?.id,
        nfc: markers.find((row) => row.channel === 'nfc')?.id,
      },
    })
    expect(token?.sealed).not.toContain(issued.rawToken)
    const scope = {
      organizationId: ORG_A,
      propertyId: portalA.propertyId,
      portalId: portalA.id,
      tokenId: token?.id ?? '',
      version: 1,
    }
    expect(cipher.open(sealed?.sealed ?? { ciphertext: '', keyVersion: 1 }, scope)).toBe(
      issued.rawToken,
    )
    expect(() =>
      cipher.open(sealed?.sealed ?? { ciphertext: '', keyVersion: 1 }, {
        ...scope,
        portalId: portalB.id,
      }),
    ).toThrow(PortalAddressCipherError)
    await expect(portalAddressRepo.findRevealable(ORG_B, portalA.id)).resolves.toBeNull()
  })

  it('keeps the address request-local when no keyring is configured', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, portalAddressRepo } = wire({ keyring: false })

    const issued = await issue({ portalId: portal.id }, ctxOf(ORG_A))

    expect(issued).toMatchObject({
      rawToken: expect.stringMatching(/^pt_/u),
      addressRecoverable: false,
    })
    expect(await tokensOf(portal)).toMatchObject([{ sealed: null, key_version: null }])
    await expect(portalAddressRepo.findRevealable(ORG_A, portal.id)).resolves.toBeNull()
  })

  it('does not report a failure that is not a collision, and writes nothing', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, reported } = wire({
      commandStore: (inner) => ({
        ...inner,
        issuePortalToken: async (command) => {
          // Another command changes the Portal between the read and the write.
          await getPool().query(
            `UPDATE portals SET updated_at = updated_at + INTERVAL '1 hour'
             WHERE id = $1`,
            [portal.id],
          )
          return inner.issuePortalToken(command)
        },
      }),
    })

    await expect(issue({ portalId: portal.id }, ctxOf(ORG_A))).rejects.toMatchObject({
      code: 'revision_conflict',
    })

    expect(reported).toEqual([])
    expect(await tokensOf(portal)).toEqual([])
    expect(await factsOf(ORG_A, 'portal.token.issued')).toEqual([])
  })
})

describe.sequential('replacing a code (real PostgreSQL, two tenants)', () => {
  it.each([0, 1.5, 91])(
    'refuses an invalid planned replacement window of %s days, changing nothing',
    async (gracePeriodDays) => {
      const portal = await seedPortal(ORG_A)
      const { issue, rotate } = wire()
      await issue({ portalId: portal.id }, ctxOf(ORG_A))
      const before = await tokensOf(portal)

      await expect(
        rotate(
          { portalId: portal.id, replacementKind: 'planned', gracePeriodDays },
          ctxOf(ORG_A),
        ),
      ).rejects.toMatchObject({ code: 'token_unavailable' })

      expect(await tokensOf(portal)).toEqual(before)
      expect(await factsOf(ORG_A, 'portal.token.rotated')).toEqual([])
    },
  )

  it('saves the QR and NFC replacements with the 30-day window and the next version, with their facts', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate } = wire({ keyring: false })
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    await rotate({ portalId: portal.id }, ctxOf(ORG_A))

    const rotated = await rotate({ portalId: portal.id }, ctxOf(ORG_A))

    expect(rotated).toMatchObject({
      version: 3,
      gracePeriodEnds: new Date(NOW.getTime() + 30 * DAY),
      addressRecoverable: false,
    })
    expect(Object.keys(rotated).sort()).toEqual([
      'addressRecoverable',
      'gracePeriodEnds',
      'publicUrl',
      'publicUrls',
      'rawToken',
      'tokenIdentifier',
      'version',
    ])
    expect(rotated.publicUrls.direct).toBe(`https://example.test/p/${rotated.rawToken}`)
    expect(rotated.publicUrls.nfc).toMatch(
      /^https:\/\/ap\.example\.test\/p\/[0-9A-Z]{20}$/u,
    )
    expect((await tokensOf(portal)).map((row) => [row.version, row.status])).toEqual([
      [1, 'rotating'],
      [2, 'rotating'],
      [3, 'active'],
    ])
    expect(await factsOf(ORG_A, 'portal.token.rotated')).toHaveLength(2)
    const published = await factsOf(ORG_A, 'portal.access_artifact.published')
    const artifacts = await artifactsOf(portal)
    expect(published.map((fact) => fact.accessArtifactId).sort()).toEqual(
      artifacts.map((row) => row.id).sort(),
    )
    expect(published.every((fact) => fact.portalId === portal.id)).toBe(true)
  })

  it('seals the new address and clears the outgoing one', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate, portalAddressRepo } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))

    const rotated = await rotate({ portalId: portal.id }, ctxOf(ORG_A))

    expect(rotated.addressRecoverable).toBe(true)
    const [outgoing, incoming] = await tokensOf(portal)
    expect(outgoing).toMatchObject({
      status: 'rotating',
      sealed: null,
      key_version: null,
    })
    expect(incoming).toMatchObject({ status: 'active', version: 2, key_version: 1 })
    const live = await portalAddressRepo.findRevealable(ORG_A, portal.id)
    expect(live).toMatchObject({ tokenId: incoming?.id, version: 2 })
    expect(
      cipher.open(live?.sealed ?? { ciphertext: '', keyVersion: 1 }, {
        organizationId: ORG_A,
        propertyId: portal.propertyId,
        portalId: portal.id,
        tokenId: incoming?.id ?? '',
        version: 2,
      }),
    ).toBe(rotated.rawToken)
    expect((await tokensOf(portal)).filter((row) => row.sealed !== null)).toHaveLength(1)
  })

  it("does not let another organization's manager replace the address", async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    const before = await tokensOf(portal)

    await expect(rotate({ portalId: portal.id }, ctxOf(ORG_B))).rejects.toMatchObject({
      code: 'portal_not_found',
    })

    expect(await tokensOf(portal)).toEqual(before)
  })
})

describe.sequential('the staff code checkpoint retry (real PostgreSQL)', () => {
  it('keeps a recoverable existing token, and refuses a missing keyring or sealed address', async () => {
    const portal = await seedPortal(ORG_A, { kind: 'personal' })
    const { issue, ensure } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    const before = await tokensOf(portal)

    await expect(ensure(ctxOf(ORG_A), portal.id)).resolves.toBeUndefined()
    expect(await tokensOf(portal)).toEqual(before)

    await expect(
      wire({ keyring: false }).ensure(ctxOf(ORG_A), portal.id),
    ).rejects.toMatchObject({ code: 'address_keyring_missing' })

    await getPool().query(
      `UPDATE portal_tokens SET encrypted_raw_token = NULL,
              address_encryption_key_version = NULL
       WHERE portal_id = $1`,
      [portal.id],
    )
    await expect(ensure(ctxOf(ORG_A), portal.id)).rejects.toMatchObject({
      code: 'address_keyring_missing',
    })
  })

  it('issues the code when the Portal has none, and refuses other organizations and place Portals', async () => {
    const personal = await seedPortal(ORG_A, { kind: 'personal' })
    const place = await seedPortal(ORG_A)
    const { ensure } = wire()

    await expect(ensure(ctxOf(ORG_B), personal.id)).rejects.toMatchObject({
      code: 'portal_not_found',
    })
    expect(await tokensOf(personal)).toEqual([])
    await expect(ensure(ctxOf(ORG_A), place.id)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(await tokensOf(place)).toEqual([])

    await expect(ensure(ctxOf(ORG_A), personal.id)).resolves.toBeUndefined()
    expect(await tokensOf(personal)).toMatchObject([
      { status: 'active', version: 1, key_version: 1 },
    ])
  })
})
