// Local-sandbox acceptance for live property-level Google Business Profile
// Performance. The browser and direct server-function probes use the real
// authorization, provider gateway, parser, lease, and Dashboard composition.

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import { gbpStubControl, type StubScope } from '../../fixtures/gbp-stub'
import type { PropertyGooglePerformanceResultV1 } from '../../../src/shared/google-performance-report-contract'
import {
  callServerFn,
  cleanupE2eData,
  dbQuery,
  e2eRunId,
  getUserByEmail,
  seedGoogleConnection,
  seedProperty,
  waitFor,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-perf-'
const seed = requireE2eSeedState()
const ACCOUNT = `${PREFIX}${e2eRunId}`
const ACCOUNT_NAME = `accounts/${ACCOUNT}`
const LOCATION_ID = `location-${e2eRunId}`
const LOCATION_NAME = `${ACCOUNT_NAME}/locations/${LOCATION_ID}`
const SERVER_FILE = 'src/contexts/integration/server/google-performance.ts'

const METRICS = [
  ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 100],
  ['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 60],
  ['BUSINESS_IMPRESSIONS_MOBILE_MAPS', 150],
  ['BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 90],
  ['BUSINESS_CONVERSATIONS', 3],
  ['BUSINESS_DIRECTION_REQUESTS', 5],
  ['CALL_CLICKS', 7],
  ['WEBSITE_CLICKS', 11],
  ['BUSINESS_BOOKINGS', 2],
  ['BUSINESS_FOOD_MENU_CLICKS', 1],
] as const

type PerformanceFixtureMode = 'complete' | 'partial' | 'zero' | 'no_data'

function propertyLocalDate(offsetDays: number): Readonly<{
  year: number
  month: number
  day: number
}> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function performanceResponse(mode: PerformanceFixtureMode): unknown {
  if (mode === 'no_data') return { multiDailyMetricTimeSeries: [] }
  const dates = Array.from({ length: 60 }, (_, index) => propertyLocalDate(index - 60))
  return {
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: METRICS.map(([dailyMetric, base], metricIndex) => ({
          dailyMetric,
          timeSeries: {
            datedValues: dates
              .filter((_, dayIndex) =>
                mode === 'partial' && metricIndex === 0 ? dayIndex !== 30 : true,
              )
              .map((date, dayIndex) => ({
                date,
                ...(mode === 'zero'
                  ? {}
                  : { value: String(base + (dayIndex >= 30 ? 2 : 0)) }),
              })),
          },
        })),
      },
    ],
  }
}

function providerScope(mode: PerformanceFixtureMode = 'complete'): StubScope {
  return {
    account: {
      name: ACCOUNT_NAME,
      accountName: `E2E Performance account ${e2eRunId}`,
      role: 'OWNER',
    },
    locations: [{ name: LOCATION_NAME, title: `E2E Performance Hotel ${e2eRunId}` }],
    reviews: {},
    performance: {
      [LOCATION_NAME]: { response: performanceResponse(mode) },
    },
  }
}

async function seedPerformanceProperty(): Promise<{ propertyId: string }> {
  await gbpStubControl.reset()
  await gbpStubControl.putScope(providerScope())

  const admin = await getUserByEmail(seed.email)
  expect(admin).toBeTruthy()
  const { connectionId } = await seedGoogleConnection({
    organizationId: seed.organizationId,
    connectedBy: admin!.id,
    googleSubject: ACCOUNT,
  })
  const { propertyId } = await seedProperty({
    organizationId: seed.organizationId,
    name: `E2E Performance Hotel ${e2eRunId}`,
    slug: `${PREFIX}${e2eRunId}`,
    googleBinding: {
      connectionId,
      accountId: ACCOUNT,
      locationId: LOCATION_ID,
    },
  })
  await dbQuery(
    `INSERT INTO property_capability (property_id, capability, created_by)
     VALUES ($1, 'property.read_gbp_performance', $2)
     ON CONFLICT (property_id, capability) DO NOTHING`,
    [propertyId, admin!.id],
  )
  await dbQuery(
    `UPDATE policy_version
     SET version = version + 1,
         updated_at = now()
     WHERE scope = 'global'`,
  )
  return { propertyId }
}

function assertNoProviderIdentifiers(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain('accounts/')
  expect(serialized).not.toContain('/locations/')
  expect(serialized).not.toContain(LOCATION_ID)
}

async function getPerformance(
  page: Parameters<typeof callServerFn>[0],
  propertyId: string,
): Promise<PropertyGooglePerformanceResultV1> {
  return callServerFn<PropertyGooglePerformanceResultV1>(page, {
    file: SERVER_FILE,
    exportName: 'getPropertyGooglePerformance',
    data: { propertyId, preset: '30d' },
  })
}

async function waitForReadyPerformance(
  page: Parameters<typeof callServerFn>[0],
  propertyId: string,
): Promise<Extract<PropertyGooglePerformanceResultV1, { status: 'ready' }>> {
  return waitFor(
    async () => {
      const result = await getPerformance(page, propertyId)
      return result.status === 'ready' ? result : null
    },
    {
      timeoutMs: 10_000,
      intervalMs: 100,
      description: 'Performance capability snapshot refresh',
    },
  )
}

test.describe('Critical workflow: live Google Performance', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('renders a live report and retains it when a manual refresh fails', async ({
    page,
  }) => {
    const { propertyId } = await seedPerformanceProperty()
    await signIn(page)

    const initial = await waitForReadyPerformance(page, propertyId)
    expect(initial.data.period.preset).toBe('30d')
    expect(initial.data.period.timezone).toBe('America/New_York')
    expect(initial.data.headlines.websiteClicks.value).toBe(390)
    expect(initial.data.headlines.websiteClicks.priorValue).toBe(330)
    expect(initial.data.sourceHealth.state).toBe('ready')
    expect(initial.data.contentTtlSeconds).toBe(900)
    assertNoProviderIdentifiers(initial)

    const callsBeforeRenewal = await gbpStubControl.calls({
      method: 'GET',
      pathPrefix: `v1/locations/${LOCATION_ID}:fetchMultiDailyMetricsTimeSeries`,
    })
    const renewed = await callServerFn<
      | Readonly<{ ok: true; lease: { leaseRef: string; leaseExpiresAt: string } }>
      | Readonly<{ ok: false }>
    >(page, {
      file: SERVER_FILE,
      exportName: 'renewPropertyGooglePerformanceLease',
      data: {
        propertyId,
        leaseRef: initial.data.authorizationLease.leaseRef,
      },
    })
    expect(renewed.ok).toBe(true)
    expect(
      await gbpStubControl.calls({
        method: 'GET',
        pathPrefix: `v1/locations/${LOCATION_ID}:fetchMultiDailyMetricsTimeSeries`,
      }),
    ).toHaveLength(callsBeforeRenewal.length)

    await page.goto(`/properties/${propertyId}?timeRange=all&performanceRange=30d`)
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    const performanceRegion = page.getByRole('region', {
      name: 'Google Business Profile performance',
    })
    await expect(performanceRegion).toBeVisible()
    await expect(
      performanceRegion.getByText('Website clicks', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      performanceRegion.getByText('390', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      performanceRegion.getByText('Source: Google Business Profile', { exact: true }),
    ).toBeVisible()

    await gbpStubControl.setPerformanceBehavior(LOCATION_NAME, {
      mode: 'status',
      status: 503,
    })
    await performanceRegion.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(
      performanceRegion.getByText('Showing the last successful report'),
    ).toBeVisible()
    await expect(
      performanceRegion.getByText('390', { exact: true }).first(),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  })

  test('fails provider faults closed, preserves zero/partial semantics, and rechecks revocation', async ({
    page,
  }) => {
    const { propertyId } = await seedPerformanceProperty()
    await signIn(page)

    await gbpStubControl.putScope(providerScope('partial'))
    const partial = await waitForReadyPerformance(page, propertyId)
    expect(partial.data.sourceHealth.state).toBe('partial')
    expect(partial.data.headlines.totalProfileImpressions.completeDayCount).toBe(29)
    assertNoProviderIdentifiers(partial)

    await gbpStubControl.putScope(providerScope('zero'))
    const allZero = await getPerformance(page, propertyId)
    expect(allZero.status).toBe('ready')
    if (allZero.status === 'ready') {
      expect(allZero.data.headlines.websiteClicks.value).toBe(0)
      expect(allZero.data.headlines.websiteClicks.availability).toBe('ready')
    }

    await gbpStubControl.putScope(providerScope('no_data'))
    const noData = await getPerformance(page, propertyId)
    expect(noData.status).toBe('ready')
    if (noData.status === 'ready') {
      expect(noData.data.sourceHealth.state).toBe('no_data')
      expect(noData.data.headlines.websiteClicks.value).toBeNull()
    }

    await gbpStubControl.putScope(providerScope())
    await gbpStubControl.setPerformanceBehavior(LOCATION_NAME, {
      mode: 'status',
      status: 429,
      retryAfterSeconds: 17,
    })
    await expect(getPerformance(page, propertyId)).resolves.toEqual({
      status: 'error',
      errorCode: 'rate_limited',
      retryable: true,
      retryAfterSeconds: 17,
    })
    // The production gateway enforces four Performance requests per endpoint-second.
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    await gbpStubControl.setPerformanceBehavior(LOCATION_NAME, { mode: 'malformed' })
    await expect(getPerformance(page, propertyId)).resolves.toEqual({
      status: 'error',
      errorCode: 'malformed_provider_response',
      retryable: false,
      retryAfterSeconds: null,
    })
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    await gbpStubControl.setPerformanceBehavior(LOCATION_NAME, {
      mode: 'oversize',
      bytes: 5 * 1024 * 1024 + 1,
    })
    await expect(getPerformance(page, propertyId)).resolves.toEqual({
      status: 'error',
      errorCode: 'malformed_provider_response',
      retryable: false,
      retryAfterSeconds: null,
    })

    await gbpStubControl.setPerformanceBehavior(LOCATION_NAME, {
      mode: 'delay',
      delayMs: 1_000,
    })
    const callsBeforeRace = (
      await gbpStubControl.calls({
        method: 'GET',
        pathPrefix: `v1/locations/${LOCATION_ID}:fetchMultiDailyMetricsTimeSeries`,
      })
    ).length
    const pending = getPerformance(page, propertyId)
    await waitFor(
      async () => {
        const calls = await gbpStubControl.calls({
          method: 'GET',
          pathPrefix: `v1/locations/${LOCATION_ID}:fetchMultiDailyMetricsTimeSeries`,
        })
        return calls.length > callsBeforeRace ? true : null
      },
      {
        timeoutMs: 5_000,
        intervalMs: 25,
        description: 'delayed Performance provider call',
      },
    )
    await dbQuery(
      `DELETE FROM property_capability
       WHERE property_id = $1 AND capability = 'property.read_gbp_performance'`,
      [propertyId],
    )
    await dbQuery(
      `UPDATE policy_version
       SET version = version + 1,
           updated_at = now()
       WHERE scope = 'global'`,
    )

    await expect(pending).resolves.toEqual({
      status: 'unavailable',
      reason: 'policy_disabled',
      action: null,
    })
  })
})
