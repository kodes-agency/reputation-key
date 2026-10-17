import { describe, expect, it, vi } from 'vitest'
import type { RecommendationPortal } from '../../domain/goal-recommendation-types'
import type {
  GoalRecommendationCounts,
  GoalRecommendationCountsQuery,
  GoalRecommendationFactsPort,
} from '../ports/goal-recommendation-facts.port'
import { GoalProgramError, type GoalActor } from './goal-program-shared'
import {
  readPortalGoalRecommendation,
  type PortalGoalRecommendationDeps,
} from './goal-recommendation-read'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}
const PROPERTY_ID = 'property-1'
// Oct 23, 2026, midday in Sofia (UTC+3 until the 25th).
const NOW = new Date('2026-10-23T09:00:00.000Z')

function portal(
  name: string,
  patch: Partial<RecommendationPortal> = {},
): RecommendationPortal {
  const since = new Date('2026-10-09T07:00:00.000Z')
  return {
    portalId: `portal-${name.toLowerCase()}`,
    name,
    publicationState: 'published',
    liveSince: since,
    liveIntervals: [{ from: since, to: null }],
    codeIssuedAt: since,
    codeReady: true,
    ...patch,
  }
}

const NO_READINGS: GoalRecommendationCounts = {
  days: [],
  unreadable: [],
  lastScanAt: new Map(),
}

function setup(
  options: Readonly<{
    timezone?: string | null
    portals?: readonly RecommendationPortal[]
    counts?: GoalRecommendationCounts
    now?: Date
  }> = {},
) {
  const calls: string[] = []
  const queries: GoalRecommendationCountsQuery[] = []
  const facts = {
    listPortalReadiness: vi.fn(async () => {
      calls.push('portals')
      return { portals: options.portals ?? [], truncated: false }
    }),
    readDailyCounts: vi.fn(async (query: GoalRecommendationCountsQuery) => {
      calls.push('counts')
      queries.push(query)
      return options.counts ?? NO_READINGS
    }),
  } satisfies GoalRecommendationFactsPort
  const deps = {
    policy: {
      authorize: vi.fn(async () => {
        calls.push('authorize')
      }),
    },
    subjects: {
      getTimezone: vi.fn(async () => {
        calls.push('timezone')
        return options.timezone === undefined ? 'Europe/Sofia' : options.timezone
      }),
    },
    facts,
    now: () => options.now ?? NOW,
  } satisfies PortalGoalRecommendationDeps
  return { deps, calls, queries }
}

const read = (deps: PortalGoalRecommendationDeps) =>
  readPortalGoalRecommendation(deps, { propertyId: PROPERTY_ID }, actor)

describe('readPortalGoalRecommendation', () => {
  it('asks goal.create under goal.use before reading', async () => {
    const { deps, calls } = setup()

    await read(deps)

    expect(deps.policy.authorize).toHaveBeenCalledWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
    expect(calls[0]).toBe('authorize')

    const refused = setup()
    refused.deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))
    await expect(read(refused.deps)).rejects.toMatchObject({ code: 'forbidden' })
    expect(refused.calls).toEqual([])
  })

  it('refuses a Property with no time zone', async () => {
    const { deps } = setup({ timezone: null })

    await expect(read(deps)).rejects.toThrow(new GoalProgramError('not_found'))
    expect(deps.facts.readDailyCounts).not.toHaveBeenCalled()
  })

  it('bounds the scan lookback by the code date', async () => {
    const recentCode = new Date('2026-10-06T08:00:00.000Z')
    const { deps } = setup({
      portals: [
        portal('Bar', {
          publicationState: 'disabled',
          liveSince: null,
          codeIssuedAt: new Date('2024-05-01T08:00:00.000Z'),
        }),
        portal('Lobby', {
          publicationState: 'draft',
          liveSince: null,
          liveIntervals: [],
        }),
        portal('Reception', { codeIssuedAt: null, codeReady: false }),
        portal('Spa', { codeIssuedAt: recentCode }),
      ],
    })

    await read(deps)

    expect(deps.facts.readDailyCounts).toHaveBeenCalledWith(
      expect.objectContaining({
        scanLookback: [
          // A code older than a year is looked at for its last year only.
          { portalId: 'portal-bar', from: new Date('2025-10-23T09:00:00.000Z') },
          { portalId: 'portal-spa', from: recentCode },
        ],
      }),
    )
  })

  it('reads the basis and this month in one range, never before the measures began', async () => {
    const fromOn = async (now: Date) => {
      const { deps, queries } = setup({ now })
      await read(deps)
      return queries[0]
    }

    // Oct 23: the basis opens Sep 25, before October.
    expect(await fromOn(NOW)).toMatchObject({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      timezone: 'Europe/Sofia',
      from: new Date('2026-09-24T21:00:00.000Z'),
      to: NOW,
    })
    // Oct 31: October opened before the basis (Oct 3).
    expect(await fromOn(new Date('2026-10-31T10:00:00.000Z'))).toMatchObject({
      from: new Date('2026-09-30T21:00:00.000Z'),
    })
    // Aug 10: the basis would open Jul 13; the measures began Aug 1.
    expect(await fromOn(new Date('2026-08-10T09:00:00.000Z'))).toMatchObject({
      from: new Date('2026-08-01T00:00:00.000Z'),
    })
  })

  it("reads the clock once and states the Property's recommendation from both reads", async () => {
    const now = vi.fn(() => NOW)
    const twoWeeks = Array.from({ length: 14 }, (_, index) => {
      const day = String(9 + index).padStart(2, '0')
      return `2026-10-${day}`
    })
    const { deps } = setup({
      portals: [portal('Reception'), portal('Restaurant')],
      counts: {
        days: twoWeeks.flatMap((localDay, index) => [
          ...(index < 11
            ? [
                {
                  portalId: 'portal-reception',
                  measure: 'portal_rating_count' as const,
                  localDay,
                  count: 1,
                },
              ]
            : []),
          ...(index < 5
            ? [
                {
                  portalId: 'portal-restaurant',
                  measure: 'portal_rating_count' as const,
                  localDay,
                  count: 1,
                },
              ]
            : []),
        ]),
        unreadable: [],
        lastScanAt: new Map(),
      },
    })

    const recommendation = await read({ ...deps, now })

    expect(now).toHaveBeenCalledTimes(1)
    expect(deps.facts.listPortalReadiness).toHaveBeenCalledWith('org-1', PROPERTY_ID, NOW)
    expect(recommendation).toMatchObject({
      asOf: NOW.toISOString(),
      state: 'ready',
      defaultMonthKey: '2026-11',
      basis: { portals: 2, weeks: 2 },
    })
    expect(recommendation.measures.portal_rating_count.fullMonth.next).toMatchObject({
      usual: 35,
      aBitMore: 40,
      stretch: 45,
    })
  })
})
