// What the Property server functions answer the browser with. The use cases
// return the Property aggregate, which carries the Google account, location and
// connection identifiers and the stored review URI; none of them may leave the
// server (application/public-api.ts, ADR 0050).

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { googleConnectionId } from '#/shared/domain/ids'
import { buildTestProperty } from '#/shared/testing/fixtures'

const mocks = vi.hoisted(() => ({
  answers: [] as unknown[],
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  listProperties: vi.fn(),
  getProperty: vi.fn(),
  updateProperty: vi.fn(),
  archiveProperty: vi.fn(),
  restoreProperty: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
// Outside the Start compiler a server function call does not hand its handler's
// answer back to the caller, so each handler's answer is kept here instead.
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      const answer = await handler(...args)
      mocks.answers.push(answer)
      return answer
    },
}))
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    propertyPublicApi: {
      management: {
        listProperties: mocks.listProperties,
        getProperty: mocks.getProperty,
        updateProperty: mocks.updateProperty,
        archiveProperty: mocks.archiveProperty,
        restoreProperty: mocks.restoreProperty,
      },
    },
  })),
}))

import { updateProperty } from './properties'
import { archivePropertyHandler, restorePropertyHandler } from './property-lifecycle'
import { getProperty, listProperties } from './property-read'

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

const ACCOUNT_SUFFIX = 'account-suffix-4410'
const LOCATION_SUFFIX = 'location-suffix-7731'
const CONNECTION_ID = 'f9000000-0000-4000-8000-0000000000c1'
const REVIEW_URI = 'https://search.google.com/local/writereview?placeid=held-9902'
const RETRIEVED_AT = new Date('2026-09-01T09:00:00.000Z')

// Archived and still linked: the destination is on hold, the state in which
// its URI is least of all a thing to hand out.
const stored = buildTestProperty({
  name: 'Harbour Hotel',
  lifecycleState: 'archived',
  gbpAccountId: ACCOUNT_SUFFIX,
  gbpLocationId: LOCATION_SUFFIX,
  googleConnectionId: googleConnectionId(CONNECTION_ID),
  googleBindingState: 'active',
  googleReviewDestination: {
    state: 'awaiting_refresh',
    uri: REVIEW_URI,
    retrievedAt: RETRIEVED_AT,
    sourceEpoch: 4,
    profileVersion: 2,
  },
})

/** The Property of a response, as the browser's JSON would carry it. */
function expectBrowserProperty(property: unknown): void {
  // What the manager app reads is still there.
  expect(property).toMatchObject({
    id: stored.id,
    name: 'Harbour Hotel',
    lifecycleState: 'archived',
    googleBindingState: 'active',
    profileVersion: stored.profileVersion,
    googleReviewDestination: { state: 'awaiting_refresh', retrievedAt: RETRIEVED_AT },
  })
  // No Google identity, under any key.
  const wire = JSON.stringify(property)
  for (const withheld of [ACCOUNT_SUFFIX, LOCATION_SUFFIX, CONNECTION_ID, REVIEW_URI]) {
    expect(wire).not.toContain(withheld)
  }
  const keys = Object.keys(property as object)
  for (const withheld of ['gbpAccountId', 'gbpLocationId', 'googleConnectionId']) {
    expect(keys).not.toContain(withheld)
  }
  expect(
    (property as { googleReviewDestination: object }).googleReviewDestination,
  ).toEqual({ state: 'awaiting_refresh', retrievedAt: RETRIEVED_AT })
}

/** What the handler of the server function just called answered. */
const lastAnswer = <T>(): T => mocks.answers.at(-1) as T

describe('Property server functions answer without Google identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.answers.length = 0
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('listProperties', async () => {
    mocks.listProperties.mockResolvedValue([stored])

    await withStartContext(() => listProperties())

    const { properties } = lastAnswer<{ properties: unknown[] }>()
    expect(properties).toHaveLength(1)
    expectBrowserProperty(properties[0])
  })

  it('getProperty', async () => {
    mocks.getProperty.mockResolvedValue(stored)

    await withStartContext(() => getProperty({ data: { propertyId: stored.id } }))

    expectBrowserProperty(lastAnswer<{ property: unknown }>().property)
  })

  it('updateProperty', async () => {
    mocks.updateProperty.mockResolvedValue(stored)

    await withStartContext(() =>
      updateProperty({ data: { propertyId: stored.id, name: 'Harbour Hotel' } }),
    )

    expectBrowserProperty(lastAnswer<{ property: unknown }>().property)
  })

  it('archiveProperty', async () => {
    mocks.archiveProperty.mockResolvedValue(stored)

    const response = await withStartContext(() =>
      archivePropertyHandler({
        data: { propertyId: stored.id, reason: 'Closed for the winter' },
      }),
    )

    expectBrowserProperty(response.property)
  })

  it('restoreProperty, which still says whether Google is ready', async () => {
    mocks.restoreProperty.mockResolvedValue({
      property: stored,
      googleBindingReadiness: 'ready',
    })

    const response = await withStartContext(() =>
      restorePropertyHandler({ data: { propertyId: stored.id } }),
    )

    expect(response.googleBindingReadiness).toBe('ready')
    expectBrowserProperty(response.property)
  })
})
