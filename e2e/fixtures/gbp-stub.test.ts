// Unit tests for the BQC-6.5 GBP stub's fetch-failure scripting (BQC-8.3).
//
// The stub gained a fetch-behavior surface mirroring the reply-behavior one:
// per-account defaults + per-location overrides, consumed by the two review
// FETCH routes (GET .../reviews and POST .../locations:batchGetReviews) so
// throttling/transient-failure drills can script 429s (with Retry-After) and
// 5xx without touching reply-publication behavior.

import { GOOGLE_ACCOUNT_PRIMARY_RESOURCE } from '../../test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  startGbpStub,
  type FetchBehavior,
  type GbpStub,
  type PerformanceBehavior,
  type StubScope,
} from './gbp-stub'

const PORT = 4199
const BASE = `http://localhost:${PORT}`

const ACCOUNT = GOOGLE_ACCOUNT_PRIMARY_RESOURCE
const LOC_A = `${ACCOUNT}/locations/loc-a`
const LOC_B = `${ACCOUNT}/locations/loc-b`

const PERFORMANCE_RESPONSE = {
  multiDailyMetricTimeSeries: [
    {
      dailyMetricTimeSeries: [
        {
          dailyMetric: 'WEBSITE_CLICKS',
          timeSeries: {
            datedValues: [
              {
                date: { year: 2026, month: 8, day: 1 },
                value: '7',
              },
            ],
          },
        },
      ],
    },
  ],
}

const SCOPE: StubScope = {
  account: {
    name: ACCOUNT,
    accountName: 'Fetch behavior account',
    role: 'OWNER',
  },
  locations: [
    { name: LOC_A, title: 'Location A' },
    { name: LOC_B, title: 'Location B' },
  ],
  reviews: {
    [LOC_A]: [
      {
        name: `${LOC_A}/reviews/r1`,
        starRating: 'FIVE',
        comment: 'great',
        createTime: '2026-01-01T00:00:00Z',
      },
    ],
    [LOC_B]: [],
  },
  performance: {
    [LOC_A]: { response: PERFORMANCE_RESPONSE },
  },
}

let stub: GbpStub

async function setFetchBehavior(
  accountName: string,
  behavior: FetchBehavior,
  locationName?: string,
): Promise<Response> {
  return fetch(`${BASE}/__control/fetch-behavior`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountName, locationName, behavior }),
  })
}

const getReviews = (location: string) => fetch(`${BASE}/${location}/reviews`)

const batchGet = (locationNames: string[]) =>
  fetch(`${BASE}/${ACCOUNT}/locations:batchGetReviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locationNames }),
  })

const fetchPerformance = (locationId = 'loc-a') =>
  fetch(
    `${BASE}/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?dailyMetrics=WEBSITE_CLICKS`,
  )

async function setPerformanceBehavior(
  locationName: string,
  behavior: PerformanceBehavior,
): Promise<Response> {
  return fetch(`${BASE}/__control/performance-behavior`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locationName, behavior }),
  })
}

beforeAll(async () => {
  stub = await startGbpStub(PORT)
  await fetch(`${BASE}/__control/reset`, { method: 'POST' })
  const res = await fetch(`${BASE}/__control/scope`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SCOPE),
  })
  expect(res.ok).toBe(true)
})

afterAll(async () => {
  await stub.stop()
})

describe('GBP stub fetch-behavior scripting (BQC-8.3)', () => {
  it('serves fetches normally when no behavior is scripted (e2e default untouched)', async () => {
    const res = await getReviews(LOC_A)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reviews: unknown[] }
    expect(body.reviews).toHaveLength(1)

    const batch = await batchGet([LOC_A, LOC_B])
    expect(batch.status).toBe(200)
  })

  it('account-level always-fail 429 fails both fetch routes and emits Retry-After', async () => {
    const control = await setFetchBehavior(ACCOUNT, {
      mode: 'always-fail',
      status: 429,
      retryAfterSeconds: 30,
    })
    expect(control.status).toBe(200)

    const res = await getReviews(LOC_A)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')

    const batch = await batchGet([LOC_B])
    expect(batch.status).toBe(429)
    expect(batch.headers.get('retry-after')).toBe('30')

    // Reply PUTs are unaffected by fetch scripting.
    const reply = await fetch(`${BASE}/${LOC_A}/reviews/r1/reply`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: 'thanks' }),
    })
    expect(reply.status).toBe(200)

    // Back to normal.
    await setFetchBehavior(ACCOUNT, { mode: 'success' })
    expect((await getReviews(LOC_A)).status).toBe(200)
  })

  it('location override beats the account default — throttle one location, serve the rest', async () => {
    await setFetchBehavior(ACCOUNT, { mode: 'always-fail', status: 500 })
    await setFetchBehavior(ACCOUNT, { mode: 'success' }, LOC_B)

    expect((await getReviews(LOC_A)).status).toBe(500)
    expect((await getReviews(LOC_B)).status).toBe(200)

    // batchGet over a mixed set fails when ANY requested location fails.
    expect((await batchGet([LOC_B, LOC_A])).status).toBe(500)
    expect((await batchGet([LOC_B])).status).toBe(200)

    await setFetchBehavior(ACCOUNT, { mode: 'success' })
    await setFetchBehavior(ACCOUNT, { mode: 'success' }, LOC_B)
  })

  it('fail-then-success consumes the scripted failures, then serves', async () => {
    await setFetchBehavior(
      ACCOUNT,
      { mode: 'fail-then-success', status: 429, failures: 2, retryAfterSeconds: 5 },
      LOC_A,
    )

    const first = await getReviews(LOC_A)
    expect(first.status).toBe(429)
    expect(first.headers.get('retry-after')).toBe('5')
    expect((await getReviews(LOC_A)).status).toBe(429)
    expect((await getReviews(LOC_A)).status).toBe(200)
    // Counter consumed — stays serving.
    expect((await getReviews(LOC_A)).status).toBe(200)
  })

  it('unknown account scope is rejected on the control route', async () => {
    const res = await setFetchBehavior(`${GOOGLE_ACCOUNT_PRIMARY_RESOURCE}-unknown`, {
      mode: 'always-fail',
      status: 429,
    })
    expect(res.status).toBe(404)
  })

  it('rejects malformed fetch behavior commands without changing the scope', async () => {
    const malformed = await fetch(`${BASE}/__control/fetch-behavior`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountName: ACCOUNT,
        behavior: { mode: 'always-fail', status: 'not-a-status' },
      }),
    })
    expect(malformed.status).toBe(400)
    expect((await getReviews(LOC_A)).status).toBe(200)
  })

  it('unknown account fetch returns 404 regardless of scripting', async () => {
    const res = await fetch(`${BASE}/accounts/nope/locations/x/reviews`)
    expect(res.status).toBe(404)
  })
})

describe('GBP stub Performance scripting', () => {
  it('serves the exact configured multi-metric response', async () => {
    const response = await fetchPerformance()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(PERFORMANCE_RESPONSE)
  })

  it('delays a response without changing its provider body', async () => {
    await setPerformanceBehavior(LOC_A, { mode: 'delay', delayMs: 20 })
    const startedAt = Date.now()

    const response = await fetchPerformance()

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15)
    expect(await response.json()).toEqual(PERFORMANCE_RESPONSE)
    await setPerformanceBehavior(LOC_A, { mode: 'success' })
  })

  it('scripts typed status and Retry-After responses', async () => {
    await setPerformanceBehavior(LOC_A, {
      mode: 'status',
      status: 429,
      retryAfterSeconds: 17,
    })

    const response = await fetchPerformance()

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('17')
    await setPerformanceBehavior(LOC_A, { mode: 'success' })
  })

  it('serves malformed and oversize response faults', async () => {
    await setPerformanceBehavior(LOC_A, { mode: 'malformed' })
    const malformed = await fetchPerformance()
    expect(malformed.status).toBe(200)
    expect(await malformed.text()).toBe('{"broken"')

    await setPerformanceBehavior(LOC_A, {
      mode: 'oversize',
      bytes: 5 * 1024 * 1024 + 1,
    })
    const oversize = await fetchPerformance()
    expect((await oversize.arrayBuffer()).byteLength).toBeGreaterThan(5 * 1024 * 1024)
    await setPerformanceBehavior(LOC_A, { mode: 'success' })
  })

  it('rejects malformed behavior and unknown location controls', async () => {
    const malformed = await fetch(`${BASE}/__control/performance-behavior`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locationName: LOC_A, behavior: { mode: 'delay' } }),
    })
    expect(malformed.status).toBe(400)
    expect((await fetchPerformance()).status).toBe(200)

    const missing = await setPerformanceBehavior(`${ACCOUNT}/locations/not-configured`, {
      mode: 'status',
      status: 500,
    })
    expect(missing.status).toBe(404)
  })
})

describe('GBP stub target binding', () => {
  it('serves the control health check when bound to every interface', async () => {
    const targetStub = await startGbpStub(4201, '0.0.0.0')
    expect(targetStub.host).toBe('0.0.0.0')
    try {
      const response = await fetch('http://127.0.0.1:4201/__control/health')
      expect(response.status).toBe(200)
    } finally {
      await targetStub.stop()
    }
  })
})
