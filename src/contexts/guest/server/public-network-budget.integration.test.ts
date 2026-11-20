// The guest budgets over PostgreSQL and the test Redis: what a device, a venue's
// shared address and the Portal's response ceiling each refuse or keep, with
// counters pre-spent as a busy venue would spend them.

import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  setupServerFunctionHarness,
  type CallRequest,
} from '#/shared/testing/server-function-harness'
import {
  PORTAL_SEED_CLEANUP_TABLES,
  type TestPublishedPortal,
} from '#/shared/testing/server-function-portal-seeds'
import {
  answerOf,
  guestCall,
  openVisit,
  portalBase,
  ratingData,
  refusalOf,
  visitAfter,
} from '#/shared/testing/server-function-guest-visitor'
import { RESPONSE_PRESSURE_MARKERS } from '../responses/response-ceiling-store.server'
import { rateLimitBudgetFor, type GuestRateLimitAction } from './guest-rate-limit-budgets'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getPublicPortal } from './guest-scans'
import {
  correctGuestResponseFn,
  selectGoogleReviewFn,
  selectSecondaryLinkFn,
  submitGuestResponseFn,
} from './public'

const NOW = new Date()
const PORTAL_HOUR_LIMIT = 300

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  redis: true,
  env: { TRUSTED_PROXY_MODE: 'xff', TRUSTED_PROXY_COUNT: '1' },
  cleanupTables: [
    'guest_response_integrity_decisions',
    'guest_response_session_bindings',
    'guest_response_private_feedback',
    'guest_response_experience_snapshots',
    'guest_responses',
    'guest_network_pressure_records',
    ...PORTAL_SEED_CLEANUP_TABLES,
  ],
  afterPropertiesCleanup: async (client, { organizationIds }) => {
    await client.query(
      `DELETE FROM idempotency_receipts
        WHERE key LIKE ANY (SELECT '%' || id || '%' FROM unnest($1::text[]) AS id)`,
      [organizationIds],
    )
  },
})

const open = (portal: Pick<TestPublishedPortal, 'rawToken'>, request: CallRequest = {}) =>
  openVisit(
    harness,
    (token) => getPublicPortal({ data: { token } }),
    portal.rawToken ?? '',
    request,
  )

const from = (last: number): CallRequest => ({
  headers: { 'x-forwarded-for': `203.0.113.${last}` },
})

async function venue(options: { skipPrivateRating?: boolean } = {}) {
  const organization = await harness.seedOrganization()
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPublishedPortal(property, options)
  return { portal }
}

/** The Redis key and pseudonym of a venue address's budget for one guest action. */
function networkOf(
  portal: TestPublishedPortal,
  last: number,
  action: GuestRateLimitAction,
  pseudonymAction: 'rating' | 'destination_action',
) {
  const scope = {
    organizationId: organizationId(portal.organizationId),
    propertyId: propertyId(portal.propertyId),
    portalId: portalId(portal.id),
  }
  const pseudonym = harness
    .container()
    .guestPublicApi.requests.guestPublicRuntime.hashNetworkPseudonym(
      `203.0.113.${last}`,
      scope,
      pseudonymAction,
      NOW,
    )
  const kind = action === 'google' || action === 'secondary' ? 'click' : 'response'
  return {
    scope,
    pseudonym,
    redisKey: `${kind}:network:${pseudonym}:portal:${portal.id}:${action}`,
    limits: rateLimitBudgetFor(action).networkPortal,
  }
}

async function spendRedis(network: ReturnType<typeof networkOf>) {
  const { rateLimiter } = harness.container()
  for (let spent = 0; spent < network.limits.maxRequests; spent++) {
    await rateLimiter.check(network.redisKey, network.limits)
  }
}

async function spendDurable(
  network: ReturnType<typeof networkOf>,
  action: 'rating' | 'destination_action',
) {
  const { guestPublicApi } = harness.container()
  for (let spent = 0; spent < network.limits.maxRequests; spent++) {
    await guestPublicApi.requests.consumeGuestNetworkPressure({
      ...network.scope,
      pseudonym: network.pseudonym,
      action,
      ...network.limits,
    })
  }
}

const integrity = async (portal: TestPublishedPortal) =>
  (
    await harness.pool().query(
      `SELECT r.integrity_outcome, r.integrity_reason_code, d.actor_id
         FROM guest_responses r
         LEFT JOIN guest_response_integrity_decisions d ON d.response_id = r.id
        WHERE r.portal_id = $1`,
      [portal.id],
    )
  ).rows

const responseCount = async (portal: TestPublishedPortal) =>
  (
    await harness
      .pool()
      .query('SELECT 1 FROM guest_responses WHERE portal_id = $1', [portal.id])
  ).rows.length

const pressure = async (portal: TestPublishedPortal, action: string) =>
  (
    await harness
      .pool()
      .query(
        'SELECT 1 FROM guest_network_pressure_records WHERE portal_id = $1 AND action = $2 AND pseudonym <> ALL($3)',
        [portal.id, action, Object.values(RESPONSE_PRESSURE_MARKERS)],
      )
  ).rows.length

const admittedSlots = async (portal: TestPublishedPortal) =>
  (
    await harness
      .pool()
      .query(
        'SELECT 1 FROM guest_network_pressure_records WHERE portal_id = $1 AND pseudonym = $2',
        [portal.id, RESPONSE_PRESSURE_MARKERS.admitted],
      )
  ).rows.length

const clickFacts = async (portal: TestPublishedPortal) =>
  (
    await harness.pool().query(
      `SELECT 1 FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'guest.review_link.clicked'`,
      [portal.organizationId],
    )
  ).rows.length

const wire = (error: unknown) => error as { code: string; status: number }

describe('a rating from one device', () => {
  it('is refused with 429 and a Retry-After once the device is out of its hourly budget', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await open(portal, from(1))
    const submit = () =>
      guestCall(harness, visit, submitGuestResponseFn, ratingData(portal), from(1))

    const answers = [await submit(), await submit(), await submit()]

    expect(answers.map((answer) => answer.ok)).toEqual([true, true, false])
    expect(wire(refusalOf(answers[2]!))).toMatchObject({
      code: 'rate_limited',
      status: 429,
    })
    const retryAfter = Number(answers[2]?.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    // The window ends on the real Redis clock, not the harness's fixed one.
    expect(retryAfter).toBeLessThanOrEqual(7200)
    expect(await responseCount(portal)).toBe(1)
    // The second submit answers the existing response and still spends a turn.
    expect(await pressure(portal, 'rating')).toBe(2)
  })

  it('does not spend a response slot when the device is refused', async ({ skip }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await open(portal, from(2))
    const submit = () =>
      guestCall(harness, visit, submitGuestResponseFn, ratingData(portal), from(2))
    await submit()
    await submit()
    const before = await admittedSlots(portal)

    await submit()

    expect(before).toBe(1)
    expect(await admittedSlots(portal)).toBe(before)
  })

  it('gives a trapped bot that is out of budget the decoy view, not a refusal', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await open(portal, from(3))
    const submit = (extra = {}) =>
      guestCall(
        harness,
        visit,
        submitGuestResponseFn,
        ratingData(portal, 5, extra),
        from(3),
      )
    await submit()
    await submit()

    const trapped = await submit({ honeypot: 'bot' })

    expect(answerOf(trapped)).toMatchObject({ status: 'submitted' })
    expect(await responseCount(portal)).toBe(1)
  })
})

describe('a rating past the venue’s network budget', () => {
  it.for(['redis', 'durable'] as const)(
    'is kept and filtered as network volume when the %s layer is spent, and the guest keeps their session',
    async (layer, { skip }) => {
      if (layer === 'redis' && !harness.redis()) skip()
      const { portal } = await venue()
      const network = networkOf(portal, 4, 'submit', 'rating')
      if (layer === 'redis') await spendRedis(network)
      else await spendDurable(network, 'rating')
      const visit = await open(portal, from(4))

      const response = await guestCall(
        harness,
        visit,
        submitGuestResponseFn,
        ratingData(portal),
        from(4),
      )

      expect(answerOf(response)).toMatchObject({ status: 'submitted', rating: 5 })
      expect(response.headers.get('retry-after')).toBeNull()
      expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
      expect(await integrity(portal)).toEqual([
        {
          integrity_outcome: 'filtered_automatically',
          integrity_reason_code: 'network_volume',
          actor_id: 'guest-integrity-network-v1',
        },
      ])
    },
  )

  it('keeps a rating inside the budget as accepted, with no integrity assessment', async () => {
    const { portal } = await venue()
    const visit = await open(portal, from(5))

    await guestCall(harness, visit, submitGuestResponseFn, ratingData(portal), from(5))

    expect(await integrity(portal)).toEqual([
      {
        integrity_outcome: 'accepted',
        integrity_reason_code: 'initial_submission',
        actor_id: 'guest.gateway',
      },
    ])
  })

  it('lets a filled honeypot win over network volume', async ({ skip }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    await spendRedis(networkOf(portal, 6, 'submit', 'rating'))
    const visit = await open(portal, from(6))

    await guestCall(
      harness,
      visit,
      submitGuestResponseFn,
      ratingData(portal, 5, { honeypot: 'bot' }),
      from(6),
    )

    expect(await integrity(portal)).toMatchObject([
      { integrity_reason_code: 'honeypot_signal' },
    ])
  })
})

describe('a correction', () => {
  it('spends no durable rating pressure, so it never shrinks the room for a new rating', async () => {
    const { portal } = await venue()
    const visit = await open(portal, from(7))
    await guestCall(harness, visit, submitGuestResponseFn, ratingData(portal, 2), from(7))

    await guestCall(
      harness,
      visit,
      correctGuestResponseFn,
      ratingData(portal, 4),
      from(7),
    )

    expect(await pressure(portal, 'rating')).toBe(1)
  })

  it('is refused with 429 past the venue’s network layer', async ({ skip }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await open(portal, from(8))
    await guestCall(harness, visit, submitGuestResponseFn, ratingData(portal, 2), from(8))
    await spendRedis(networkOf(portal, 8, 'correct', 'rating'))

    const response = await guestCall(
      harness,
      visit,
      correctGuestResponseFn,
      ratingData(portal, 4),
      from(8),
    )

    expect(wire(refusalOf(response))).toMatchObject({ code: 'rate_limited', status: 429 })
    expect(response.headers.get('retry-after')).not.toBeNull()
  })
})

describe('the Google step past the venue’s network budget', () => {
  it.for(['redis', 'durable'] as const)(
    'still opens Google when the %s layer is spent, and records no click',
    async (layer, { skip }) => {
      if (layer === 'redis' && !harness.redis()) skip()
      const { portal } = await venue()
      const visit = await open(portal, from(9))
      await guestCall(harness, visit, submitGuestResponseFn, ratingData(portal), from(9))
      const network = networkOf(portal, 9, 'google', 'destination_action')
      if (layer === 'redis') await spendRedis(network)
      else await spendDurable(network, 'destination_action')

      const response = await guestCall(
        harness,
        visit,
        selectGoogleReviewFn,
        portalBase(portal),
        from(9),
      )

      expect(answerOf(response)).toMatchObject({
        url: expect.stringContaining('https://'),
      })
      expect(response.headers.get('retry-after')).toBeNull()
      expect(await clickFacts(portal)).toBe(0)
    },
  )
})

describe('a secondary link tap past the budgets', () => {
  const tap = (portal: TestPublishedPortal) => ({
    ...portalBase(portal),
    linkId: portal.linkId,
  })

  it('still answers the link when the device has spent its daily taps', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    const visit = await open(portal, from(13))

    const answers = []
    for (let taps = 0; taps < 4; taps++) {
      answers.push(
        await guestCall(harness, visit, selectSecondaryLinkFn, tap(portal), from(13)),
      )
    }

    expect(answers.map((answer) => answerOf(answer))).toEqual(
      Array(4).fill({ url: portal.linkUrl }),
    )
    expect(answers.every((answer) => answer.headers.get('retry-after') === null)).toBe(
      true,
    )
  })

  it('still answers the link when the venue’s network budget is spent, and records no tap', async ({
    skip,
  }) => {
    if (!harness.redis()) skip()
    const { portal } = await venue()
    await spendRedis(networkOf(portal, 14, 'secondary', 'destination_action'))
    const visit = await open(portal, from(14))

    const response = await guestCall(
      harness,
      visit,
      selectSecondaryLinkFn,
      tap(portal),
      from(14),
    )

    expect(answerOf(response)).toEqual({ url: portal.linkUrl })
    expect(await clickFacts(portal)).toBe(0)
  })
})

describe('the Portal’s response ceiling', () => {
  async function fillHour(portal: TestPublishedPortal) {
    await harness.pool().query(
      `INSERT INTO guest_network_pressure_records
         (id, organization_id, property_id, portal_id, pseudonym, action, observed_at, expires_at)
       SELECT gen_random_uuid(), $1, $2, $3, $4, 'rating', $5::timestamptz,
              $5::timestamptz + INTERVAL '7 days'
         FROM generate_series(1, $6)`,
      [
        portal.organizationId,
        portal.propertyId,
        portal.id,
        RESPONSE_PRESSURE_MARKERS.admitted,
        NOW,
        PORTAL_HOUR_LIMIT,
      ],
    )
  }

  it('returns a dropped receipt without writing a response, and the page recovers it on reload', async () => {
    const { portal } = await venue()
    await fillHour(portal)
    const visit = await open(portal)

    const response = await guestCall(
      harness,
      visit,
      submitGuestResponseFn,
      ratingData(portal, 4),
    )
    const reloaded = await open(portal, {
      cookies: visitAfter(visit, response.headers).cookies,
    })

    expect(answerOf(response)).toMatchObject({ dropped: true })
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
    expect(await responseCount(portal)).toBe(0)
    expect(reloaded.page.response).toMatchObject({ dropped: true })
  })

  it('keeps Google open for a guest whose response was dropped, without a click fact', async () => {
    const { portal } = await venue()
    await fillHour(portal)
    const visit = await open(portal)
    const dropped = await guestCall(
      harness,
      visit,
      submitGuestResponseFn,
      ratingData(portal, 4),
    )

    const google = await guestCall(
      harness,
      visitAfter(visit, dropped.headers),
      selectGoogleReviewFn,
      portalBase(portal),
    )

    expect(answerOf(google)).toMatchObject({ url: expect.stringContaining('https://') })
    expect(await clickFacts(portal)).toBe(0)
  })

  it('does not reserve another slot for a session that already has a response', async () => {
    const { portal } = await venue()
    const visit = await open(portal)
    await guestCall(harness, visit, submitGuestResponseFn, ratingData(portal, 4))
    const before = await admittedSlots(portal)

    await guestCall(harness, visit, submitGuestResponseFn, ratingData(portal, 1))

    expect(await admittedSlots(portal)).toBe(before)
  })
})
