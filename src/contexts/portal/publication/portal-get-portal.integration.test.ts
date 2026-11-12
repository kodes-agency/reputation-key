// Reading one Portal with the state of its code on real PostgreSQL, with two
// organizations: what a manager may see, what the status says about the live
// code through issue, replacement and revocation, and who made it. The real
// use cases run over the real stores, cipher and command store; only the clock
// and the two Identity-side ports (assignments, display names) are supplied.

import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { organizationId, type PropertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { PortalAddressFormat } from '../application/portal-address-urls'
import type { PortalActorDirectory } from '../application/ports/portal-actor-directory.port'
import { getPortal } from '../application/use-cases/get-portal'
import { issuePortalToken } from '../application/use-cases/issue-portal-token'
import { revokePortalTokens } from '../application/use-cases/revoke-portal-tokens'
import { rotatePortalToken } from '../application/use-cases/rotate-portal-token'
import { createPortalAddressCipher } from '../infrastructure/adapters/portal-address-cipher'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import { seedClusterPortal } from '../infrastructure/testing/portal-token-cluster-fixtures'
import { testPortalTokenCodec } from '../infrastructure/testing/portal-token-codec-fixture'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-get-portal-0000000000000001')
const ORG_B = organizationId('org-get-portal-0000000000000002')
const NOW = new Date('2026-08-21T10:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://example.test',
  printOrigin: 'https://ap.example.test',
}
const SEALING_KEY = `2:${'ab'.repeat(32)}`
const NEWER_KEY = `3:${'cd'.repeat(32)}`

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

const seedPortal = (org: string) =>
  seedClusterPortal(getPool(), org, {
    updatedAt: new Date(NOW.getTime() - DAY),
  })

const cipherOf = (keyring: string) =>
  createPortalAddressCipher({ keyring, generateIv: () => randomBytes(12) })

const namedPeople = (names: Readonly<Record<string, string>>): PortalActorDirectory => ({
  resolveDisplayNames: async (_org, ids) =>
    new Map(ids.flatMap((id) => (names[id] === undefined ? [] : [[id, names[id]]]))),
})

type Wiring = Readonly<{
  /** The keyring that sealed the codes, when one is configured. */
  sealWith?: string
  /** The keyring the read asks, when it differs from the sealing one. */
  readWith?: string | null
  accessible?: ReadonlyArray<PropertyId> | null
  directory?: PortalActorDirectory
  readAt?: Date
}>

function wire(options: Wiring = {}) {
  const db = getDb()
  const staffPublicApi = {
    getAccessiblePropertyIds: async () => options.accessible ?? null,
    getAssignedPortals: async () => [],
  } as unknown as StaffPublicApi
  const sealing = options.sealWith === undefined ? null : cipherOf(options.sealWith)
  const common = {
    portalRepo: createPortalRepository(db),
    portalTokenRepo: createPortalTokenRepository(db),
    staffPublicApi,
    commandStore: createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
    tokenCodec: testPortalTokenCodec(),
    addressCipher: sealing,
    reportPrintCodeProblem: () => undefined,
    idGen: randomUUID,
    clock: () => NOW,
    address: ADDRESS,
  }
  const readCipher =
    options.readWith === undefined
      ? sealing
      : options.readWith === null
        ? null
        : cipherOf(options.readWith)
  return {
    issue: issuePortalToken(common),
    rotate: rotatePortalToken({ ...common, defaultGracePeriodSeconds: 30 * 86_400 }),
    revoke: revokePortalTokens(common),
    read: getPortal({
      portalRepo: common.portalRepo,
      portalTokenRepo: common.portalTokenRepo,
      staffPublicApi,
      actorDirectory: options.directory ?? namedPeople({}),
      addressCipher: readCipher,
      clock: () => options.readAt ?? NOW,
    }),
  }
}

const ctxOf = (org: string, role: 'PropertyManager' | 'Member' = 'PropertyManager') =>
  buildTestAuthContext({ organizationId: organizationId(org), role })

const NO_CODE = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
  addressRecoverable: false,
  madeBy: null,
}

describe.sequential('reading a Portal (real PostgreSQL, two tenants)', () => {
  it('returns a portal by id', async () => {
    const portal = await seedPortal(ORG_A)
    const { read } = wire()

    const result = await read({ portalId: portal.id }, ctxOf(ORG_A))

    expect(result.portal).toMatchObject({ id: portal.id, name: 'Cluster portal' })
  })

  it('rejects an unknown portal and a portal of another organization', async () => {
    const portal = await seedPortal(ORG_A)
    const { read } = wire()

    await expect(read({ portalId: randomUUID() }, ctxOf(ORG_A))).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'portal_not_found',
    })
    await expect(read({ portalId: portal.id }, ctxOf(ORG_B))).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'portal_not_found',
    })
  })

  it('rejects a PropertyManager who lacks assignment to the portal property', async () => {
    const portal = await seedPortal(ORG_A)
    const { read } = wire({ accessible: [] })

    await expect(read({ portalId: portal.id }, ctxOf(ORG_A))).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'forbidden',
    })
  })

  it('reports no active token when nothing resolves, and never another organization code', async () => {
    const portalA = await seedPortal(ORG_A)
    const portalB = await seedPortal(ORG_B)
    const { issue, revoke, read } = wire()
    expect((await read({ portalId: portalA.id }, ctxOf(ORG_A))).tokenStatus).toEqual(
      NO_CODE,
    )

    await issue({ portalId: portalA.id }, ctxOf(ORG_A))
    expect((await read({ portalId: portalB.id }, ctxOf(ORG_B))).tokenStatus).toEqual(
      NO_CODE,
    )

    await revoke({ portalId: portalA.id, reason: 'leaked' }, ctxOf(ORG_A))
    expect((await read({ portalId: portalA.id }, ctxOf(ORG_A))).tokenStatus).toEqual(
      NO_CODE,
    )
  })

  it('reports an active token as ISO metadata without any token material', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, read } = wire()
    const issued = await issue({ portalId: portal.id }, ctxOf(ORG_A))

    const { tokenStatus } = await read({ portalId: portal.id }, ctxOf(ORG_A))

    expect(tokenStatus).toEqual({
      hasActiveToken: true,
      qualifiedScanReady: true,
      version: 1,
      issuedAt: NOW.toISOString(),
      graceExpiresAt: null,
      addressRecoverable: false,
      madeBy: null,
    })
    expect(Object.keys(tokenStatus).sort()).toEqual([
      'addressRecoverable',
      'graceExpiresAt',
      'hasActiveToken',
      'issuedAt',
      'madeBy',
      'qualifiedScanReady',
      'version',
    ])
    expect(JSON.stringify(tokenStatus)).not.toContain(issued.rawToken)
  })

  it('is not scan-ready while no marker of the code is published', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, read } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    await getPool().query(
      `UPDATE portal_access_artifacts SET status = 'retired', retired_at = $2 WHERE portal_id = $1`,
      [portal.id, NOW],
    )

    const { tokenStatus } = await read({ portalId: portal.id }, ctxOf(ORG_A))

    expect(tokenStatus).toMatchObject({ hasActiveToken: true, qualifiedScanReady: false })
  })

  it('reports the replacement as current, with the window the printed code is still inside', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate, read } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    await rotate(
      { portalId: portal.id, replacementKind: 'planned', gracePeriodDays: 1 },
      ctxOf(ORG_A),
    )
    const graceEnds = new Date(NOW.getTime() + DAY)

    const inside = await read({ portalId: portal.id }, ctxOf(ORG_A))

    expect(inside.tokenStatus).toMatchObject({
      hasActiveToken: true,
      version: 2,
      graceExpiresAt: graceEnds.toISOString(),
    })
  })

  it('asks for resolvability as of the injected clock: a window that has ended is not reported', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    await rotate(
      { portalId: portal.id, replacementKind: 'planned', gracePeriodDays: 1 },
      ctxOf(ORG_A),
    )

    const later = wire({ readAt: new Date(NOW.getTime() + 2 * DAY) })
    const { tokenStatus } = await later.read({ portalId: portal.id }, ctxOf(ORG_A))

    expect(tokenStatus).toMatchObject({
      hasActiveToken: true,
      version: 2,
      graceExpiresAt: null,
    })
  })

  it('says the address can be downloaded again only while the keyring holds its key', async () => {
    const portal = await seedPortal(ORG_A)
    const sealed = wire({ sealWith: SEALING_KEY })
    await sealed.issue({ portalId: portal.id }, ctxOf(ORG_A))
    const withKey = wire({
      sealWith: SEALING_KEY,
      readWith: `${NEWER_KEY},${SEALING_KEY}`,
    })
    const retired = wire({ sealWith: SEALING_KEY, readWith: NEWER_KEY })
    const noKeyring = wire({ sealWith: SEALING_KEY, readWith: null })

    const recoverable = async (reader: typeof withKey) =>
      (await reader.read({ portalId: portal.id }, ctxOf(ORG_A))).tokenStatus
        .addressRecoverable

    expect(await recoverable(withKey)).toBe(true)
    expect(await recoverable(retired)).toBe(false)
    expect(await recoverable(noKeyring)).toBe(false)
  })

  describe('who made the code', () => {
    it('names the person who made the live code', async () => {
      const portal = await seedPortal(ORG_A)
      const ctx = ctxOf(ORG_A)
      const { issue, read } = wire({
        directory: namedPeople({ [ctx.userId]: 'Georgi Ivanov' }),
      })
      await issue({ portalId: portal.id }, ctx)

      const result = await read({ portalId: portal.id }, ctx)

      expect(result.tokenStatus.madeBy).toBe('Georgi Ivanov')
    })

    it('leaves the name out when the directory cannot name them', async () => {
      const portal = await seedPortal(ORG_A)
      const { issue, read } = wire()
      await issue({ portalId: portal.id }, ctxOf(ORG_A))

      const result = await read({ portalId: portal.id }, ctxOf(ORG_A))

      expect(result.tokenStatus.madeBy).toBeNull()
    })

    it('shows an operator under the fixed label and never asks the directory', async () => {
      const portal = await seedPortal(ORG_A)
      const resolveDisplayNames = vi.fn<PortalActorDirectory['resolveDisplayNames']>(
        async () => new Map(),
      )
      const { issue, read } = wire({ directory: { resolveDisplayNames } })
      await issue({ portalId: portal.id }, ctxOf(ORG_A))
      await getPool().query(
        `UPDATE portal_tokens SET issued_by = 'ops:ada' WHERE portal_id = $1`,
        [portal.id],
      )

      const result = await read({ portalId: portal.id }, ctxOf(ORG_A))

      expect(result.tokenStatus.madeBy).toBe('Reputation Key')
      expect(JSON.stringify(result.tokenStatus)).not.toContain('ada')
      expect(resolveDisplayNames).not.toHaveBeenCalled()
    })

    it('asks nobody when the code records no maker', async () => {
      const portal = await seedPortal(ORG_A)
      const resolveDisplayNames = vi.fn<PortalActorDirectory['resolveDisplayNames']>(
        async () => new Map(),
      )
      const { issue, read } = wire({ directory: { resolveDisplayNames } })
      await issue({ portalId: portal.id }, ctxOf(ORG_A))
      await getPool().query(
        `UPDATE portal_tokens SET issued_by = NULL WHERE portal_id = $1`,
        [portal.id],
      )

      const result = await read({ portalId: portal.id }, ctxOf(ORG_A))

      expect(result.tokenStatus.madeBy).toBeNull()
      expect(resolveDisplayNames).not.toHaveBeenCalled()
    })
  })
})
