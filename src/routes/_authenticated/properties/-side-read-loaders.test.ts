// The four loaders that hold the page for a side read at most a grace, and what
// each leaves in the request's QueryClient when a read misses it (see
// `#/routes/-queries/prime-within-grace.ts`).
//
// Each loader names the keys of its own reads, because the module that starts them
// loads on demand. These run the real loaders over the real prefetching modules,
// with every side read held, and ask the one question that catches a read nobody
// named: is anything left pending in the client the SSR integration is about to send?
import { hashKey, QueryClient, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardKeys, goalKeys, propertyKeys } from '#/shared/queries/query-keys'

const mocks = vi.hoisted(() => ({
  getProperty: vi.fn(),
  getPropertyOverviewFn: vi.fn(),
  getPropertyInsightsFn: vi.fn(),
}))

// The reads a page needs before it can draw: these answer. Its side reads do not
// go through the server functions at all (see `requestClient`).
vi.mock('#/contexts/property/server/properties', () => ({
  getProperty: mocks.getProperty,
}))
vi.mock('#/contexts/reporting/server/dashboard', () => ({
  getPropertyOverviewFn: mocks.getPropertyOverviewFn,
}))
vi.mock('#/contexts/ai/server/property-insights', () => ({
  getPropertyInsightsFn: mocks.getPropertyInsightsFn,
}))

// The modules the loaders load on demand, loaded now: a grace of fake time would
// otherwise end while they are still being read from disk.
import './-properties-prefetch'
import './$propertyId/goals/-goals-page-prefetch'
import { Route as ListRoute } from './index'
import { Route as OverviewRoute } from './$propertyId/index'
import { Route as SettingsRoute } from './$propertyId/settings'
import { Route as GuestsRoute, propertyGuestsQuery } from './$propertyId/guests'

const PROPERTY = '10000000-0000-4000-8000-000000000001'
const GRACE_MS = 300
const SUMMARIES = [{ propertyId: PROPERTY, completedCount: 1, stepCount: 3 }]

type Answers = ReadonlyArray<readonly [QueryKey, unknown]>

/**
 * A request's client whose side reads (`prefetchQuery`, `prefetchInfiniteQuery`)
 * answer at once if `answers` has their key and never otherwise, and which notes
 * the key of every side read started. The reads a page needs (`ensureQueryData`)
 * are the ones the mocked server functions above answer.
 */
function requestClient(answers: Answers = []) {
  const started: string[] = []
  const queryClient = new QueryClient()
  const answerFor = (queryKey: QueryKey): Promise<unknown> => {
    started.push(hashKey(queryKey))
    const found = answers.find(([key]) => hashKey(key) === hashKey(queryKey))
    return found ? Promise.resolve(found[1]) : new Promise(() => undefined)
  }
  const prefetchQuery = queryClient.prefetchQuery.bind(queryClient)
  queryClient.prefetchQuery = ((options: { queryKey: QueryKey }) =>
    prefetchQuery({
      ...options,
      queryFn: () => answerFor(options.queryKey),
    })) as typeof queryClient.prefetchQuery
  const prefetchInfiniteQuery = queryClient.prefetchInfiniteQuery.bind(queryClient)
  queryClient.prefetchInfiniteQuery = ((
    options: Parameters<typeof prefetchInfiniteQuery>[0],
  ) =>
    prefetchInfiniteQuery({
      ...options,
      queryFn: () => answerFor(options.queryKey),
    })) as typeof queryClient.prefetchInfiniteQuery
  return { queryClient, started }
}

/** What the SSR integration would send as pending: a read with no answer yet. */
const pending = (queryClient: QueryClient) =>
  queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.status === 'pending')
    .map((query) => query.queryKey)

/**
 * Runs a route's loader to the end of its grace, with the clock the test holds.
 * The loader is called the way the router calls it, with the context a request has.
 */
async function loaded(
  route: { options: { loader?: unknown } },
  args: Readonly<Record<string, unknown>>,
): Promise<void> {
  const loader = route.options.loader
  if (typeof loader !== 'function') {
    throw new Error('The route must define a loader function')
  }
  const loading: unknown = loader(args as never)
  await vi.advanceTimersByTimeAsync(GRACE_MS * 2)
  await loading
}

describe('the loaders that hold the page for a side read', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.clearAllMocks()
    mocks.getProperty.mockResolvedValue({ property: { id: PROPERTY, name: 'Hotel' } })
    mocks.getPropertyOverviewFn.mockResolvedValue({ dashboard: {} })
    mocks.getPropertyInsightsFn.mockResolvedValue({ status: 'ready' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('on the server', () => {
    it('Properties drops both reads when neither has answered', async () => {
      const { queryClient, started } = requestClient()

      await loaded(ListRoute, { context: { queryClient } })

      expect(started.sort()).toEqual(
        [dashboardKeys.fleet('all'), propertyKeys.setupSummaries()]
          .map((key) => hashKey(key))
          .sort(),
      )
      expect(pending(queryClient)).toEqual([])
    })

    it('Properties keeps the setup progress when it has answered and drops the figures', async () => {
      const { queryClient } = requestClient([[propertyKeys.setupSummaries(), SUMMARIES]])

      await loaded(ListRoute, { context: { queryClient } })

      expect(queryClient.getQueryData(propertyKeys.setupSummaries())).toEqual(SUMMARIES)
      expect(queryClient.getQueryState(dashboardKeys.fleet('all'))).toBeUndefined()
      expect(pending(queryClient)).toEqual([])
    })

    it('the property overview drops its setup strip and its goals, and keeps the reads it needs', async () => {
      // The goal card answers that there is no goal, which starts the two reads
      // behind it (the setup, the history).
      const { queryClient, started } = requestClient([
        [goalKeys.ratingGoalRead(PROPERTY, 'card'), { state: 'none' }],
      ])

      await loaded(OverviewRoute, {
        params: { propertyId: PROPERTY },
        context: {
          queryClient,
          role: 'AccountAdmin',
          capabilities: { allowed: ['goal.use'] },
        },
      })

      expect(started.sort()).toEqual(
        [
          propertyKeys.setup(PROPERTY),
          goalKeys.ratingGoalRead(PROPERTY, 'card'),
          goalKeys.ratingGoalRead(PROPERTY, 'setup'),
          goalKeys.ratingGoalRead(PROPERTY, 'history'),
          goalKeys.portalGoalRead(PROPERTY, 'card'),
        ]
          .map((key) => hashKey(key))
          .sort(),
      )
      expect(
        queryClient.getQueryData(
          dashboardKeys.property({ propertyId: PROPERTY, timeRange: 'all' }),
        ),
      ).toEqual({ dashboard: {} })
      expect(queryClient.getQueryData(goalKeys.ratingGoalRead(PROPERTY, 'card'))).toEqual(
        {
          state: 'none',
        },
      )
      expect(pending(queryClient)).toEqual([])
    })

    it('the property settings drop the setup strip and keep the property', async () => {
      const { queryClient, started } = requestClient()

      await loaded(SettingsRoute, {
        params: { propertyId: PROPERTY },
        context: { queryClient },
      })

      expect(started).toEqual([hashKey(propertyKeys.setup(PROPERTY))])
      expect(queryClient.getQueryData(propertyKeys.detail(PROPERTY))).toEqual({
        property: { id: PROPERTY, name: 'Hotel' },
      })
      expect(pending(queryClient)).toEqual([])
    })

    it('Guest voice drops the headline and keeps the topics', async () => {
      const { queryClient, started } = requestClient()

      await loaded(GuestsRoute, {
        params: { propertyId: PROPERTY },
        location: { search: {} },
        context: { queryClient },
      })

      expect(started).toHaveLength(1)
      expect(
        queryClient.getQueryData(propertyGuestsQuery(PROPERTY, 'auto').queryKey),
      ).toEqual({ status: 'ready' })
      expect(pending(queryClient)).toEqual([])
    })
  })

  describe('in the browser', () => {
    it('Properties lets the figures go on in the background', async () => {
      vi.stubGlobal('document', {})
      const { queryClient } = requestClient()

      await loaded(ListRoute, { context: { queryClient } })

      expect(pending(queryClient)).toContainEqual(dashboardKeys.fleet('all'))
    })
  })
})
