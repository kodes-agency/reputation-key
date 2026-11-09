// Issue, replace and revoke a Portal's address on real PostgreSQL, with two
// organizations: the results a manager sees, the refusals, the facts recorded,
// and the printed addresses. The real use cases run over the real stores, codec
// and command store; only the clock and ids are fixed.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { PortalAddressFormat } from '../application/portal-address-urls'
import { issuePortalToken } from '../application/use-cases/issue-portal-token'
import { revokePortalTokens } from '../application/use-cases/revoke-portal-tokens'
import { rotatePortalToken } from '../application/use-cases/rotate-portal-token'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import { testPortalTokenCodec } from '../infrastructure/testing/portal-token-codec-fixture'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-token-commands-00000000001')
const ORG_B = organizationId('org-token-commands-00000000002')
const NOW = new Date('2026-10-25T09:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ADDRESS: PortalAddressFormat = {
  appOrigin: 'https://app.example.test',
  printOrigin: 'https://ap.example.test',
}
const staffPublicApi = {
  getAccessiblePropertyIds: async () => null,
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

async function seedPortal(org: string) {
  const property = randomUUID()
  const portal = randomUUID()
  const slug = `token-${portal.slice(0, 8)}`
  const earlier = new Date(NOW.getTime() - 60 * 60 * 1000)
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Token property', $3, 'UTC')`,
    [property, org, slug],
  )
  await getPool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                          name, slug, publication_state, theme, created_by, created_at,
                          updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'Token portal', $5, 'published',
             '{"primaryColor":"#6366F1"}'::jsonb, 'manager-token', $6, $6)`,
    [portal, org, property, property, slug, earlier],
  )
  return { id: portalId(portal), propertyId: propertyId(property), org }
}

function wire() {
  const db = getDb()
  const common = {
    portalRepo: createPortalRepository(db),
    portalTokenRepo: createPortalTokenRepository(db),
    staffPublicApi,
    commandStore: createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
    tokenCodec: testPortalTokenCodec(),
    addressCipher: null,
    reportPrintCodeProblem: () => undefined,
    idGen: randomUUID,
    clock: () => NOW,
    address: ADDRESS,
  }
  return {
    issue: issuePortalToken(common),
    rotate: rotatePortalToken({ ...common, defaultGracePeriodSeconds: 30 * 86_400 }),
    revoke: revokePortalTokens(common),
  }
}

const ctxOf = (org: string, role: 'PropertyManager' | 'Member' = 'PropertyManager') =>
  buildTestAuthContext({ organizationId: organizationId(org), role })

type TokenRow = Readonly<{
  organization_id: string
  status: string
  version: number
  grace_period_ends: Date | null
  revoked_by: string | null
  revoked_reason: string | null
}>

const tokensOf = async (portal: Readonly<{ id: string }>) =>
  (
    await getPool().query<TokenRow>(
      `SELECT organization_id, status, version, grace_period_ends, revoked_by,
              revoked_reason
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
  ).rows

const countRows = async (table: string, org: string) =>
  Number(
    (
      await getPool().query<{ n: string }>(
        `SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`,
        [org],
      )
    ).rows[0]?.n,
  )

const PRINTED = /^HTTPS:\/\/AP\.EXAMPLE\.TEST\/p\/[0-9A-Z]{20}$/u

describe.sequential('Portal token commands (real PostgreSQL, two tenants)', () => {
  it('issues a tenant-bound token, records its facts and returns the printed addresses', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue } = wire()

    const issued = await issue({ portalId: portal.id }, ctxOf(ORG_A))

    expect(issued).toMatchObject({ version: 1, issuedAt: NOW, addressRecoverable: false })
    expect(issued.rawToken).toMatch(/^pt_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/u)
    expect(issued.publicUrls.qr).toMatch(PRINTED)
    expect(issued.publicUrls.nfc).toMatch(
      /^https:\/\/ap\.example\.test\/p\/[0-9A-Z]{20}$/u,
    )
    expect(issued.publicUrls.direct).toBe(`https://app.example.test/p/${issued.rawToken}`)
    expect(await tokensOf(portal)).toMatchObject([
      { organization_id: ORG_A, status: 'active', version: 1 },
    ])
    expect(await factsOf(ORG_A, 'portal.token.issued')).toHaveLength(1)
    const published = await factsOf(ORG_A, 'portal.access_artifact.published')
    expect(published.map((row) => row.payload.channel).sort()).toEqual(['nfc', 'qr'])
  })

  it('asks for a rotation while a token is live', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))

    await expect(issue({ portalId: portal.id }, ctxOf(ORG_A))).rejects.toMatchObject({
      code: 'token_unavailable',
    })
    expect(await tokensOf(portal)).toHaveLength(1)
  })

  it('replaces the address with a 30-day printed-code window and keeps the old one for it', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate } = wire()
    const first = await issue({ portalId: portal.id }, ctxOf(ORG_A))

    const rotated = await rotate({ portalId: portal.id }, ctxOf(ORG_A))

    expect(rotated.version).toBe(2)
    expect(rotated.gracePeriodEnds).toEqual(new Date(NOW.getTime() + 30 * DAY))
    expect(rotated.publicUrls.qr).toMatch(PRINTED)
    expect(rotated.publicUrls.qr).not.toBe(first.publicUrls.qr)
    expect(await tokensOf(portal)).toMatchObject([
      { status: 'rotating', version: 1, grace_period_ends: rotated.gracePeriodEnds },
      { status: 'active', version: 2 },
    ])
    expect(await factsOf(ORG_A, 'portal.token.rotated')).toHaveLength(1)
  })

  it('replaces the address at once for a security replacement and refuses a window with it', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))

    await expect(
      rotate(
        { portalId: portal.id, replacementKind: 'security', gracePeriodDays: 7 },
        ctxOf(ORG_A),
      ),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
    expect(await tokensOf(portal)).toHaveLength(1)

    const rotated = await rotate(
      { portalId: portal.id, replacementKind: 'security' },
      ctxOf(ORG_A),
    )
    expect(rotated.gracePeriodEnds).toEqual(NOW)
  })

  it('refuses to replace an address that was never issued', async () => {
    const portal = await seedPortal(ORG_A)
    const { rotate } = wire()

    await expect(rotate({ portalId: portal.id }, ctxOf(ORG_A))).rejects.toMatchObject({
      code: 'token_unavailable',
    })
    expect(await tokensOf(portal)).toEqual([])
  })

  it('revokes the live tokens with a trimmed reason and records one fact', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, rotate, revoke } = wire()
    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    await rotate({ portalId: portal.id }, ctxOf(ORG_A))

    await expect(
      revoke({ portalId: portal.id, reason: '  compromised print  ' }, ctxOf(ORG_A)),
    ).resolves.toEqual({ revoked: 2 })

    const rows = await tokensOf(portal)
    expect(rows.map((row) => row.status)).toEqual(['revoked', 'revoked'])
    expect(rows.every((row) => row.revoked_reason === 'compromised print')).toBe(true)
    expect(await factsOf(ORG_A, 'portal.token.revoked')).toHaveLength(1)
  })

  it('records no revocation fact when no token was live, and refuses a blank reason', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue, revoke } = wire()

    await expect(
      revoke({ portalId: portal.id, reason: 'retired' }, ctxOf(ORG_A)),
    ).resolves.toEqual({ revoked: 0 })
    expect(await factsOf(ORG_A, 'portal.token.revoked')).toHaveLength(0)

    await issue({ portalId: portal.id }, ctxOf(ORG_A))
    await expect(
      revoke({ portalId: portal.id, reason: '   ' }, ctxOf(ORG_A)),
    ).rejects.toMatchObject({ code: 'token_unavailable' })
    expect((await tokensOf(portal)).map((row) => row.status)).toEqual(['active'])
  })

  it('refuses a role that cannot update the Portal, changing nothing', async () => {
    const portal = await seedPortal(ORG_A)
    const { issue } = wire()

    await expect(
      issue({ portalId: portal.id }, ctxOf(ORG_A, 'Member')),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(await tokensOf(portal)).toEqual([])
    expect(await countRows('outbox_events', ORG_A)).toBe(0)
  })

  it("denies another organization's manager every token command, changing nothing in either", async () => {
    const portalA = await seedPortal(ORG_A)
    const portalB = await seedPortal(ORG_B)
    const { issue, rotate, revoke } = wire()
    await issue({ portalId: portalA.id }, ctxOf(ORG_A))
    await issue({ portalId: portalB.id }, ctxOf(ORG_B))
    const before = {
      a: await tokensOf(portalA),
      b: await tokensOf(portalB),
      factsA: await countRows('outbox_events', ORG_A),
      factsB: await countRows('outbox_events', ORG_B),
    }

    const intruder = ctxOf(ORG_B)
    const denied = { code: 'portal_not_found' }
    await expect(issue({ portalId: portalA.id }, intruder)).rejects.toMatchObject(denied)
    await expect(rotate({ portalId: portalA.id }, intruder)).rejects.toMatchObject(denied)
    await expect(
      revoke({ portalId: portalA.id, reason: 'not yours' }, intruder),
    ).rejects.toMatchObject(denied)

    expect(await tokensOf(portalA)).toEqual(before.a)
    expect(await tokensOf(portalB)).toEqual(before.b)
    expect(await countRows('outbox_events', ORG_A)).toBe(before.factsA)
    expect(await countRows('outbox_events', ORG_B)).toBe(before.factsB)
  })

  it("keeps each organization's tokens apart when both replace and revoke", async () => {
    const portalA = await seedPortal(ORG_A)
    const portalB = await seedPortal(ORG_B)
    const { issue, rotate, revoke } = wire()
    await issue({ portalId: portalA.id }, ctxOf(ORG_A))
    await issue({ portalId: portalB.id }, ctxOf(ORG_B))
    await rotate({ portalId: portalA.id }, ctxOf(ORG_A))

    await revoke({ portalId: portalB.id, reason: 'retired' }, ctxOf(ORG_B))

    expect((await tokensOf(portalA)).map((row) => row.status)).toEqual([
      'rotating',
      'active',
    ])
    expect((await tokensOf(portalB)).map((row) => row.status)).toEqual(['revoked'])
    expect(await factsOf(ORG_A, 'portal.token.revoked')).toHaveLength(0)
    expect(await factsOf(ORG_B, 'portal.token.revoked')).toHaveLength(1)
  })
})
