// The scan beacon, the public page read and the link fallback, called as a
// guest's browser would over PostgreSQL and the test Redis: the real Portal
// lookup, signed session, public execution decision and rate limits.

import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  setupServerFunctionHarness,
  type CallRequest,
  type ServerFunctionHarness,
} from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'
import type { TestPublishedPortal } from '#/shared/testing/server-function-portal-seeds'
import { QUALIFIED_SCAN_BUDGET } from './guest-rate-limit-budgets'
import { guestRateLimitKeys } from './guest-session'
import {
  guestRequest,
  openVisit,
  venueAddress,
  type GuestVisit,
} from '#/shared/testing/server-function-guest-visitor'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getPublicPortal, recordScanFn, resolvePublicPortalLink } from './guest-scans'

const NOW = new Date()

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  redis: true,
  env: { TRUSTED_PROXY_MODE: 'xff', TRUSTED_PROXY_COUNT: '1' },
  cleanupTables: [
    'guest_qualified_scans',
    'scan_events',
    'guest_network_pressure_records',
    ...PORTAL_SEED_CLEANUP_TABLES,
  ],
  afterPropertiesCleanup: async (client, { organizationIds }) => {
    await client.query(
      `DELETE FROM idempotency_receipts
        WHERE scope = 'guest_qualified_scan'
          AND key LIKE ANY (SELECT '%' || id || '%' FROM unnest($1::text[]) AS id)`,
      [organizationIds],
    )
  },
})

const openPortal = (
  _harness: ServerFunctionHarness,
  portal: Pick<TestPublishedPortal, 'rawToken'>,
  request: CallRequest = {},
  token = portal.rawToken ?? '',
) =>
  openVisit(
    harness,
    (opened) => getPublicPortal({ data: { token: opened } }),
    token,
    request,
  )

async function venue() {
  const organization = await harness.seedOrganization()
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPublishedPortal(property)
  return { organization, property, portal }
}

const addressOf = (portal: TestPublishedPortal) => portal.printCodes?.qr ?? ''

const beaconData = (portal: TestPublishedPortal, visit: GuestVisit, token?: string) => ({
  token: token ?? addressOf(portal),
  csrfNonce: visit.csrfNonce,
  accessArtifactId: null,
})

const scanFacts = async (portal: TestPublishedPortal) => {
  const { rows } = await harness
    .pool()
    .query(
      'SELECT session_id FROM scan_events WHERE portal_id = $1 ORDER BY created_at',
      [portal.id],
    )
  const qualified = await harness
    .pool()
    .query('SELECT id FROM guest_qualified_scans WHERE portal_id = $1', [portal.id])
  return { events: rows.length, qualified: qualified.rows.length }
}

const pressureRows = async (portal: TestPublishedPortal, action: string) =>
  (
    await harness
      .pool()
      .query(
        'SELECT id FROM guest_network_pressure_records WHERE portal_id = $1 AND action = $2',
        [portal.id, action],
      )
  ).rows.length

const wire = (error: unknown) => {
  const { name, code, status, message } = error as Error & {
    code: string
    status: number
  }
  return { name, code, status, message }
}

/** The Redis key and pressure pseudonym a venue address gets on this Portal. */
function networkFor(portal: TestPublishedPortal, last: number) {
  const requests = harness.container().guestPublicApi.requests
  const scope = {
    organizationId: organizationId(portal.organizationId),
    propertyId: propertyId(portal.propertyId),
    portalId: portalId(portal.id),
  }
  const pseudonym = requests.guestPublicRuntime.hashNetworkPseudonym(
    `203.0.113.${last}`,
    scope,
    'qualified_scan',
    NOW,
  )
  return {
    scope,
    pseudonym,
    redisKey: guestRateLimitKeys('scan', 'session', pseudonym, portal.id).networkPortal,
  }
}

async function spendNetworkBudget(
  harness: ServerFunctionHarness,
  portal: TestPublishedPortal,
  last: number,
  layer: 'redis' | 'durable',
) {
  const { scope, pseudonym, redisKey } = networkFor(portal, last)
  const { maxRequests, windowSeconds } = QUALIFIED_SCAN_BUDGET.networkPortal
  const { rateLimiter, guestPublicApi } = harness.container()
  for (let spent = 0; spent < maxRequests; spent++) {
    if (layer === 'redis')
      await rateLimiter.check(redisKey, { maxRequests, windowSeconds })
    else {
      await guestPublicApi.requests.consumeGuestNetworkPressure({
        ...scope,
        pseudonym,
        action: 'qualified_scan',
        maxRequests,
        windowSeconds,
      })
    }
  }
}

describe('recordScanFn', () => {
  it('records a qualified scan for the Portal and answers success', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal, {}, addressOf(portal))

    const answer = await harness.callAs(
      null,
      () => recordScanFn({ data: beaconData(portal, visit) }),
      guestRequest(visit, { headers: venueAddress(7) }),
    )

    expect(answer).toEqual({ success: true, retryable: false })
    expect(await scanFacts(portal)).toEqual({ events: 1, qualified: 1 })
    expect(await pressureRows(portal, 'qualified_scan')).toBe(1)
  })

  it('answers an unknown Portal address with 404 and writes nothing', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal, {}, addressOf(portal))

    const error = await harness
      .callAs(
        null,
        () => recordScanFn({ data: beaconData(portal, visit, 'pt_unknown_address') }),
        guestRequest(visit),
      )
      .catch((caught: unknown) => caught)

    expect(wire(error)).toEqual({
      name: 'GuestError',
      code: 'portal_not_found',
      status: 404,
      message: 'Portal not found',
    })
    expect(await scanFacts(portal)).toEqual({ events: 0, qualified: 0 })
    expect(await pressureRows(portal, 'qualified_scan')).toBe(0)
  })

  it('answers a revoked address like an unknown one', async () => {
    const { property } = await venue()
    const revoked = await harness.seedPublishedPortal(property, { token: 'revoked' })

    await expect(
      harness.callAs(null, () =>
        recordScanFn({
          data: {
            token: revoked.rawToken ?? '',
            csrfNonce: crypto.randomUUID(),
            accessArtifactId: null,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it('gives a session that does not fit the same answer as an unknown address', async () => {
    const { portal } = await venue()
    const visit = await openPortal(harness, portal, {}, addressOf(portal))
    const unknown = await harness
      .callAs(
        null,
        () => recordScanFn({ data: beaconData(portal, visit, 'pt_unknown_address') }),
        guestRequest(visit),
      )
      .catch((caught: unknown) => caught)

    const noCookie = await harness
      .callAs(null, () => recordScanFn({ data: beaconData(portal, visit) }), {
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/140' },
      })
      .catch((caught: unknown) => caught)
    const wrongNonce = await harness
      .callAs(
        null,
        () =>
          recordScanFn({
            data: { ...beaconData(portal, visit), csrfNonce: crypto.randomUUID() },
          }),
        guestRequest(visit),
      )
      .catch((caught: unknown) => caught)

    expect(wire(noCookie)).toEqual(wire(unknown))
    expect(wire(wrongNonce)).toEqual(wire(unknown))
    expect(await scanFacts(portal)).toEqual({ events: 0, qualified: 0 })
  })

  it('does not count a signed-in member of the Portal’s Organization', async () => {
    const { organization, portal } = await venue()
    const member = await harness.seedMember(organization, 'Member')
    const visit = await openPortal(harness, portal, {}, addressOf(portal))

    const answer = await harness.callAs(
      member,
      () => recordScanFn({ data: beaconData(portal, visit) }),
      guestRequest(visit),
    )

    expect(answer).toEqual({ success: true, retryable: false })
    expect(await scanFacts(portal)).toEqual({ events: 0, qualified: 0 })
  })

  it('refuses the fourth beacon of one device in the hour with 429 and a Retry-After', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await openPortal(harness, portal, {}, addressOf(portal))
    const beacon = () =>
      harness.respondAs(
        null,
        () => recordScanFn({ data: beaconData(portal, visit) }),
        guestRequest(visit, { headers: venueAddress(8) }),
      )

    const answers = [await beacon(), await beacon(), await beacon(), await beacon()]

    expect(answers.map((answer) => answer.ok)).toEqual([true, true, true, false])
    const refused = answers[3]
    expect(refused?.ok === false && wire(refused.error)).toMatchObject({
      name: 'GuestError',
      code: 'rate_limit_exceeded',
      status: 429,
    })
    const retryAfter = Number(refused?.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    // The window ends on the real Redis clock, not the harness's fixed one.
    expect(retryAfter).toBeLessThanOrEqual(7200)
    expect((await scanFacts(portal)).qualified).toBe(1)
  })

  it('refuses a venue whose Redis network budget is spent, for another device too', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    await spendNetworkBudget(harness, portal, 9, 'redis')
    const visit = await openPortal(harness, portal, {}, addressOf(portal))

    const response = await harness.respondAs(
      null,
      () => recordScanFn({ data: beaconData(portal, visit) }),
      guestRequest(visit, { headers: venueAddress(9) }),
    )

    expect(response.ok === false && wire(response.error)).toMatchObject({
      code: 'rate_limit_exceeded',
      status: 429,
    })
    expect(response.headers.get('retry-after')).not.toBeNull()
    expect(await scanFacts(portal)).toEqual({ events: 0, qualified: 0 })
  })

  it('refuses a venue whose durable network budget is spent', async () => {
    const { portal } = await venue()
    await spendNetworkBudget(harness, portal, 10, 'durable')
    const visit = await openPortal(harness, portal, {}, addressOf(portal))

    const response = await harness.respondAs(
      null,
      () => recordScanFn({ data: beaconData(portal, visit) }),
      guestRequest(visit, { headers: venueAddress(10) }),
    )

    expect(response.ok === false && wire(response.error)).toMatchObject({
      code: 'rate_limit_exceeded',
      status: 429,
    })
    expect(await scanFacts(portal)).toEqual({ events: 0, qualified: 0 })
  })

  it('serves another venue address while one is out of budget', async () => {
    const { portal } = await venue()
    await spendNetworkBudget(harness, portal, 11, 'durable')
    const visit = await openPortal(harness, portal, {}, addressOf(portal))

    await expect(
      harness.callAs(
        null,
        () => recordScanFn({ data: beaconData(portal, visit) }),
        guestRequest(visit, { headers: venueAddress(12) }),
      ),
    ).resolves.toEqual({ success: true, retryable: false })
  })
})

describe('a print code on the guest routes', () => {
  it('reads the page of a print code like any address, with no address in the loader data', async () => {
    const { portal } = await venue()
    const code = addressOf(portal)

    const byCode = await harness.callAs(null, () =>
      getPublicPortal({ data: { token: code } }),
    )
    const byAddress = await harness.callAs(null, () =>
      getPublicPortal({ data: { token: portal.rawToken ?? '' } }),
    )

    expect(code).toHaveLength(20)
    expect(byCode.portal.name).toBe(byAddress.portal.name)
    expect(byCode.links).toEqual(byAddress.links)
    for (const [loaded, token] of [
      [byCode, code],
      [byAddress, portal.rawToken ?? ''],
    ] as const) {
      expect(loaded).not.toHaveProperty('addressShape')
      expect(JSON.stringify(loaded)).not.toContain(token)
    }
  })

  it('resolves a link by the print code', async () => {
    const { portal } = await venue()

    await expect(
      harness.callAs(null, () =>
        resolvePublicPortalLink({
          data: { token: addressOf(portal), linkId: portal.linkId },
        }),
      ),
    ).resolves.toEqual({ url: portal.linkUrl })
  })

  it('stays navigation-only: resolving a link counts no scan and records no tap', async () => {
    const { portal, organization } = await venue()

    await harness.callAs(null, () =>
      resolvePublicPortalLink({
        data: { token: addressOf(portal), linkId: portal.linkId },
      }),
    )

    const facts = await harness.pool().query(
      `SELECT
         (SELECT count(*) FROM guest_qualified_scans WHERE organization_id = $1) AS scans,
         (SELECT count(*) FROM outbox_events
           WHERE organization_id = $1 AND event_type = 'guest.review_link.clicked') AS taps`,
      [organization.id],
    )
    expect(facts.rows).toEqual([{ scans: '0', taps: '0' }])
  })

  it('resolves no link for an unknown code', async () => {
    const { portal } = await venue()

    await expect(
      harness.callAs(null, () =>
        resolvePublicPortalLink({
          data: { token: '7K3QZ0VD9MWX4HT2BN6R', linkId: portal.linkId },
        }),
      ),
    ).resolves.toBeNull()
  })
})
