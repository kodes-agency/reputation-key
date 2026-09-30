import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  type PortalGroupId,
  type PortalId,
} from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type {
  MetricPortalMetricEvidence,
  MetricPortalMetricEvidenceSet,
} from '../ports/portal-analytics.repository'
import type {
  PortalResultsCell,
  PortalResultsOverviewRepository,
  PortalResultsReadingGroup,
  PortalResultsWindow,
  PortalResultsWindowReading,
} from '../ports/portal-results-overview.repository'
import { localDaysWindow, priorPeriodDates } from '../utils'
import {
  PORTAL_RESULTS_PORTAL_LIMIT,
  getPortalResultsOverview,
  type GetPortalResultsOverviewInput,
  type PortalResultsRosterEntry,
} from './get-portal-results-overview'

const ORG = organizationId('org-results-overview')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')
const OTHER_PROP = propertyId('a0000000-0000-4000-8000-000000000002')
const P1 = portalId('b0000000-0000-4000-8000-000000000001')
const P2 = portalId('b0000000-0000-4000-8000-000000000002')
const P3 = portalId('b0000000-0000-4000-8000-000000000003')
const P4 = portalId('b0000000-0000-4000-8000-000000000004')
const G1 = portalGroupId('c0000000-0000-4000-8000-000000000001')
const G2 = portalGroupId('c0000000-0000-4000-8000-000000000002')

// "Last 30 days" on 30 Sep (noon) is 1 Sep to now, and the 30 days before are 2 Aug
// to noon on 31 Aug: equally long, and both after qualified scans began (2026-08-01).
const NOW = new Date('2026-09-30T12:00:00.000Z')
const RANGE = {
  startAt: new Date('2026-09-01T00:00:00.000Z'),
  endAt: NOW,
}
const PRIOR = {
  startAt: new Date('2026-08-02T00:00:00.000Z'),
  endAt: new Date('2026-08-31T12:00:00.000Z'),
}
const UTC = 'UTC'
const AUCKLAND = 'Pacific/Auckland'
const COMPUTED_AT = new Date('2026-10-01T00:05:00.000Z')

const roster = (
  entries: readonly [PortalId, PortalGroupId | null][],
): PortalResultsRosterEntry[] =>
  entries.map(([id, groupId]) => ({ portalId: id, propertyId: PROP, groupId }))

function evidence(
  versionId: string,
  overrides: Partial<MetricPortalMetricEvidence> = {},
): MetricPortalMetricEvidence {
  return {
    definitionVersionId: versionId,
    state: 'ready',
    verifiedThrough: COMPUTED_AT,
    latestActivity: null,
    computedAt: COMPUTED_AT,
    completeness: 1,
    availabilityReason: null,
    correctionHead: null,
    ...overrides,
  }
}

function readyEvidence(
  overrides: Partial<
    Record<keyof MetricPortalMetricEvidenceSet, MetricPortalMetricEvidence>
  > = {},
): MetricPortalMetricEvidenceSet {
  return {
    scans: evidence(METRIC_VERSION_IDS.qualifiedScanGoal),
    privateRatings: evidence(METRIC_VERSION_IDS.portalRatingAnalytics),
    privateFeedback: evidence(METRIC_VERSION_IDS.portalFeedbackAnalytics),
    reviewLinkClicks: evidence(METRIC_VERSION_IDS.portalDestinationClickAnalytics),
    ...overrides,
  }
}

const cell = (
  portal: PortalId,
  groupId: PortalGroupId | null,
  metricKey: string,
  total: number,
  count = total,
): PortalResultsCell => ({ portalId: portal, groupId, metricKey, total, count })

const scans = (portal: PortalId, group: PortalGroupId | null, n: number) =>
  cell(portal, group, 'portal.qualified_scan', n)
const ratings = (
  portal: PortalId,
  group: PortalGroupId | null,
  stars: number,
  n: number,
) => cell(portal, group, 'portal.rating', stars, n)
const notes = (portal: PortalId, group: PortalGroupId | null, n: number) =>
  cell(portal, group, 'portal.feedback', n)
const opens = (portal: PortalId, group: PortalGroupId | null, n: number) =>
  cell(portal, group, 'portal.review_link_click', n)

type WindowFixture = Readonly<{
  cells?: readonly PortalResultsCell[]
  evidence?: ReadonlyMap<PortalId, MetricPortalMetricEvidenceSet>
  readingGroups?: readonly PortalResultsReadingGroup[]
}>

function fakeRepository(windows: {
  current?: WindowFixture
  prior?: WindowFixture
  /** Picks a fixture by the window asked for, when Properties read different ones. */
  by?: (window: PortalResultsWindow) => WindowFixture
}) {
  const readWindow = vi.fn<PortalResultsOverviewRepository['readWindow']>(
    async ({ portals, window }): Promise<PortalResultsWindowReading> => {
      const fixture =
        windows.by?.(window) ??
        (window.startAt.getTime() === RANGE.startAt.getTime()
          ? windows.current
          : windows.prior) ??
        {}
      return {
        computedAt: COMPUTED_AT,
        cells: fixture.cells ?? [],
        readingGroups: fixture.readingGroups ?? [],
        evidence: portals.map(({ portalId: id }) => ({
          portalId: id,
          evidence: fixture.evidence?.get(id) ?? readyEvidence(),
        })),
      }
    },
  )
  return { results: { readWindow }, readWindow }
}

/** Asks for 30 days in UTC for the one Property, unless told otherwise. */
const ask = (
  repo: { results: PortalResultsOverviewRepository },
  portals: readonly PortalResultsRosterEntry[],
  extra: Partial<GetPortalResultsOverviewInput> = {},
  now: Date = NOW,
) =>
  getPortalResultsOverview({ results: repo.results, now: () => now })({
    scope,
    portals,
    properties: [{ propertyId: PROP, timezone: UTC }],
    timeRange: '30d',
    compare: false,
    ...extra,
  })

const scope = { organizationId: ORG, propertyId: PROP }
const inProperty = (
  property: typeof PROP,
  entries: readonly [PortalId, PortalGroupId | null][],
): PortalResultsRosterEntry[] =>
  entries.map(([id, groupId]) => ({ portalId: id, propertyId: property, groupId }))

describe('getPortalResultsOverview', () => {
  it('reads each window once however many Portals are asked about', async () => {
    const repo = fakeRepository({})
    const many = Array.from({ length: 40 }, (_, i) =>
      portalId(`b1000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    )

    await ask(repo, roster(many.map((id) => [id, null])), { compare: true })

    expect(repo.readWindow).toHaveBeenCalledTimes(2)
    const windows = repo.readWindow.mock.calls.map(([call]) => call.window)
    expect(windows).toEqual(expect.arrayContaining([RANGE, PRIOR]))
    expect(repo.readWindow.mock.calls[0]?.[0].portals).toHaveLength(40)
  })

  it('reads one window when no comparison is asked for', async () => {
    const repo = fakeRepository({ current: { cells: [scans(P1, null, 3)] } })

    const overview = await ask(repo, roster([[P1, null]]))

    expect(repo.readWindow).toHaveBeenCalledTimes(1)
    expect(overview.properties[0]).toMatchObject({
      period: RANGE,
      comparePeriod: null,
    })
    expect(overview.portals[0]?.kpis.scans.priorValue).toBeNull()
  })

  describe('Properties in different time zones', () => {
    const local = localDaysWindow('30d', NOW, AUCKLAND)
    const localPrior = priorPeriodDates('30d', local.startDate, local.endDate, AUCKLAND)
    const AUCKLAND_RANGE = { startAt: local.startDate, endAt: local.endDate }
    const AUCKLAND_PRIOR = {
      startAt: localPrior?.priorStartDate as Date,
      endAt: localPrior?.priorEndDate as Date,
    }
    const same = (left: PortalResultsWindow, right: PortalResultsWindow) =>
      left.startAt.getTime() === right.startAt.getTime() &&
      left.endAt.getTime() === right.endAt.getTime()
    // Each Property has readings only in its own local windows: a Property read
    // through the other's window would find nothing.
    const byWindow = (window: PortalResultsWindow): WindowFixture => {
      if (same(window, RANGE)) return { cells: [scans(P1, null, 10)] }
      if (same(window, PRIOR)) return { cells: [scans(P1, null, 4)] }
      if (same(window, AUCKLAND_RANGE)) return { cells: [scans(P2, null, 20)] }
      if (same(window, AUCKLAND_PRIOR)) return { cells: [scans(P2, null, 5)] }
      return {}
    }
    const portals = [
      ...inProperty(PROP, [[P1, null]]),
      ...inProperty(OTHER_PROP, [[P2, null]]),
    ]
    const both = {
      scope: { organizationId: ORG, propertyId: null },
      properties: [
        { propertyId: PROP, timezone: UTC },
        { propertyId: OTHER_PROP, timezone: AUCKLAND },
      ],
      compare: true,
    }

    it("reads each Property through the window that Property's own Results view uses", async () => {
      const repo = fakeRepository({ by: byWindow })

      const overview = await ask(repo, portals, both)

      expect(AUCKLAND_RANGE.startAt).not.toEqual(RANGE.startAt)
      expect(overview.properties.map((row) => [row.propertyId, row.period])).toEqual([
        [PROP, RANGE],
        [OTHER_PROP, AUCKLAND_RANGE],
      ])
      expect(overview.properties.map((row) => row.comparePeriod)).toEqual([
        PRIOR,
        AUCKLAND_PRIOR,
      ])
      const byPortal = (id: PortalId) =>
        overview.portals.find((row) => row.portalId === id)
      expect(byPortal(P1)?.kpis.scans).toMatchObject({ value: 10, priorValue: 4 })
      expect(byPortal(P2)?.kpis.scans).toMatchObject({ value: 20, priorValue: 5 })
    })

    it('reads a window once per distinct window, and asks each only about the Portals that use it', async () => {
      const repo = fakeRepository({ by: byWindow })

      await ask(repo, portals, both)

      // Two windows in each of two time zones: four statements sets, not one per Portal.
      expect(repo.readWindow).toHaveBeenCalledTimes(4)
      for (const [call] of repo.readWindow.mock.calls) {
        const ids = call.portals.map((portal) => portal.portalId)
        expect(ids).toEqual(
          same(call.window, RANGE) || same(call.window, PRIOR) ? [P1] : [P2],
        )
      }
    })

    it('shares a read between Properties that sit in the same time zone', async () => {
      const repo = fakeRepository({})

      await ask(repo, portals, {
        ...both,
        properties: [
          { propertyId: PROP, timezone: UTC },
          { propertyId: OTHER_PROP, timezone: UTC },
        ],
      })

      expect(repo.readWindow).toHaveBeenCalledTimes(2)
      expect(repo.readWindow.mock.calls[0]?.[0].portals).toHaveLength(2)
    })

    it('gives each Property a subtotal and the total the sum of those readings', async () => {
      const repo = fakeRepository({ by: byWindow })

      const overview = await ask(repo, portals, both)

      const [utcRow, aucklandRow] = overview.properties
      expect(utcRow).toMatchObject({ propertyId: PROP, portalIds: [P1] })
      expect(utcRow?.kpis.scans).toMatchObject({ value: 10, priorValue: 4 })
      expect(aucklandRow).toMatchObject({ propertyId: OTHER_PROP, portalIds: [P2] })
      expect(aucklandRow?.kpis.scans).toMatchObject({ value: 20, priorValue: 5 })
      expect(overview.total.portalIds).toEqual([P1, P2])
      expect(overview.total.kpis.scans).toMatchObject({ value: 30, priorValue: 9 })
    })

    it('keeps groups and ungrouped rows inside their own Property', async () => {
      const repo = fakeRepository({
        by: (window) =>
          same(window, RANGE)
            ? { cells: [scans(P1, G1, 1), scans(P3, null, 2)] }
            : same(window, AUCKLAND_RANGE)
              ? { cells: [scans(P2, G2, 7)] }
              : {},
      })

      const overview = await ask(
        repo,
        [
          ...inProperty(PROP, [
            [P1, G1],
            [P3, null],
          ]),
          ...inProperty(OTHER_PROP, [[P2, G2]]),
        ],
        both,
      )

      expect(
        overview.groups.map((row) => [row.propertyId, row.groupId, row.kpis.scans.value]),
      ).toEqual([
        [PROP, G1, 1],
        [OTHER_PROP, G2, 7],
      ])
      expect(
        overview.ungrouped.map((row) => [row.propertyId, row.memberPortalIds]),
      ).toEqual([
        [PROP, [P3]],
        [OTHER_PROP, []],
      ])
      expect(overview.ungrouped[0]?.kpis.scans.value).toBe(2)
    })
  })

  it('gives a Portal the five measures with prior values and trends', async () => {
    const repo = fakeRepository({
      current: {
        cells: [
          scans(P1, G1, 20),
          ratings(P1, G1, 45, 10),
          notes(P1, G1, 3),
          opens(P1, G1, 6),
        ],
      },
      prior: { cells: [scans(P1, G1, 10), ratings(P1, G1, 36, 10)] },
    })

    const { portals } = await ask(repo, roster([[P1, G1]]), { compare: true })

    const kpis = portals[0]?.kpis
    expect(portals[0]).toMatchObject({ portalId: P1, propertyId: PROP, groupId: G1 })
    expect(kpis?.scans).toMatchObject({ value: 20, priorValue: 10, trend: 100 })
    expect(kpis?.ratings).toMatchObject({ value: 10, priorValue: 10 })
    expect(kpis?.avgRating).toMatchObject({
      value: 4.5,
      priorValue: 3.6,
      comparison: 0.9,
      sampleCount: 10,
    })
    expect(kpis?.feedback.value).toBe(3)
    expect(kpis?.googleOpens.value).toBe(6)
  })

  it('returns the scan funnel on every kind of row, from the same assembly', async () => {
    const repo = fakeRepository({
      current: {
        cells: [scans(P1, G1, 20), ratings(P1, G1, 45, 10), opens(P1, G1, 6)],
      },
    })

    const overview = await ask(repo, roster([[P1, G1]]))

    const funnel = { qualifiedScans: 20, ratings: 10, googleOpens: 6 }
    expect(overview.portals[0]?.engagementFunnel).toEqual(funnel)
    expect(overview.groups[0]?.engagementFunnel).toEqual(funnel)
    expect(overview.properties[0]?.engagementFunnel).toEqual(funnel)
    expect(overview.total.engagementFunnel).toEqual(funnel)
    expect(overview.ungrouped[0]?.engagementFunnel).toEqual({
      qualifiedScans: 0,
      ratings: 0,
      googleOpens: 0,
    })
  })

  it('withholds the funnel where a family is not ready', async () => {
    const updating = readyEvidence({
      scans: evidence(METRIC_VERSION_IDS.qualifiedScanGoal, {
        state: 'updating',
        verifiedThrough: null,
        availabilityReason: 'consumer_receipt_pending',
      }),
    })
    const repo = fakeRepository({ current: { evidence: new Map([[P1, updating]]) } })

    const overview = await ask(repo, roster([[P1, null]]))

    expect(overview.portals[0]?.engagementFunnel).toBeNull()
    expect(overview.total.engagementFunnel).toBeNull()
  })

  it('shows a Portal with nothing counted as a verified zero, not as missing', async () => {
    const repo = fakeRepository({})

    const { portals } = await ask(repo, roster([[P1, null]]))

    const kpis = portals[0]?.kpis
    expect(kpis?.scans).toMatchObject({ value: 0, evidence: { state: 'ready' } })
    expect(kpis?.googleOpens.value).toBe(0)
    // No ratings at all: no average, and no "too few" wording for it either.
    expect(kpis?.avgRating.value).toBeNull()
    expect(kpis?.avgRating.evidence.availabilityReason).toBeNull()
  })

  it('sums a group from its Portals and averages ratings by weight', async () => {
    const repo = fakeRepository({
      current: {
        cells: [
          // P1: 4 ratings of 5 stars = 20 -> would show 5.0 alone... but only n=4.
          ratings(P1, G1, 20, 4),
          // P2: 6 ratings summing 24 (4.0 each).
          ratings(P2, G1, 24, 6),
          scans(P1, G1, 10),
          scans(P2, G1, 5),
          opens(P2, G1, 2),
          notes(P1, G1, 1),
        ],
      },
    })

    const { groups } = await ask(
      repo,
      roster([
        [P1, G1],
        [P2, G1],
      ]),
    )

    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group?.groupId).toBe(G1)
    expect(group?.propertyId).toBe(PROP)
    expect(group?.memberPortalIds).toEqual([P1, P2])
    expect(group?.contributingPortalIds).toEqual([P1, P2])
    expect(group?.kpis.scans.value).toBe(15)
    expect(group?.kpis.ratings.value).toBe(10)
    // Weighted: 44 stars over 10 ratings, not the mean of 5.0 and 4.0.
    expect(group?.kpis.avgRating).toMatchObject({ value: 4.4, sampleCount: 10 })
    expect(group?.kpis.googleOpens.value).toBe(2)
    expect(group?.kpis.feedback.value).toBe(1)
  })

  it('holds a group average back below the sample floor, with the true n', async () => {
    const two = roster([
      [P1, G1],
      [P2, G1],
    ])
    const repo = fakeRepository({
      current: { cells: [ratings(P1, G1, 12, 3), ratings(P2, G1, 8, 2)] },
    })

    const { groups } = await ask(repo, two)

    // Five ratings clear the floor of five; four would not.
    expect(groups[0]?.kpis.avgRating).toMatchObject({ value: 4, sampleCount: 5 })

    const repoSmall = fakeRepository({
      current: { cells: [ratings(P1, G1, 12, 3), ratings(P2, G1, 4, 1)] },
    })
    const small = await ask(repoSmall, two)
    expect(small.groups[0]?.kpis.avgRating).toMatchObject({
      value: null,
      sampleCount: 4,
      evidence: {
        state: 'insufficient_data',
        availabilityReason: 'below_minimum_sample',
      },
    })
  })

  it("keeps a moved Portal's earlier results with its old group", async () => {
    // P1 sat in G1 and moved to G2 mid-window: 5 scans counted under G1, 2 under G2.
    const repo = fakeRepository({
      current: { cells: [scans(P1, G1, 5), scans(P1, G2, 2), scans(P2, G1, 1)] },
    })

    const { portals, groups, total } = await ask(
      repo,
      roster([
        [P1, G2],
        [P2, G1],
      ]),
    )

    expect(portals.find((row) => row.portalId === P1)?.kpis.scans.value).toBe(7)
    const g1 = groups.find((row) => row.groupId === G1)
    const g2 = groups.find((row) => row.groupId === G2)
    expect(g1?.kpis.scans.value).toBe(6)
    expect(g2?.kpis.scans.value).toBe(2)
    // P1 no longer belongs to G1, so it is not one of its members ("1 portal"),
    // but its readings there make it a contributor to G1's evidence.
    expect(g1?.memberPortalIds).toEqual([P2])
    expect(g1?.contributingPortalIds).toEqual([P1, P2])
    expect(g2?.memberPortalIds).toEqual([P1])
    expect(g2?.contributingPortalIds).toEqual([P1])
    expect(total.kpis.scans.value).toBe(8)
  })

  it("speaks for a moved Portal's uncounted readings under its old group too", async () => {
    // P1 moved from G1 to G2. Its facts from G1 are still being applied, so it
    // has no counted cell under G1, but a reading under G1 already exists.
    const updating = readyEvidence({
      scans: evidence(METRIC_VERSION_IDS.qualifiedScanGoal, {
        state: 'updating',
        verifiedThrough: null,
        availabilityReason: 'consumer_receipt_pending',
      }),
    })
    const repo = fakeRepository({
      current: {
        cells: [scans(P1, G2, 2), scans(P2, G1, 4)],
        readingGroups: [
          { portalId: P1, groupId: G1 },
          { portalId: P1, groupId: G2 },
          { portalId: P2, groupId: G1 },
        ],
        evidence: new Map([[P1, updating]]),
      },
    })

    const { groups } = await ask(
      repo,
      roster([
        [P1, G2],
        [P2, G1],
      ]),
    )

    const g1 = groups.find((row) => row.groupId === G1)
    expect(g1?.memberPortalIds).toEqual([P2])
    expect(g1?.contributingPortalIds).toEqual([P1, P2])
    expect(g1?.kpis.scans).toMatchObject({
      value: null,
      evidence: { state: 'updating' },
    })
  })

  it('makes a group of a Portal that has only readings the store could not count', async () => {
    const unavailable = readyEvidence({
      scans: evidence(METRIC_VERSION_IDS.qualifiedScanGoal, {
        state: 'unavailable',
        verifiedThrough: null,
        availabilityReason: 'invalid_readings',
      }),
    })
    const repo = fakeRepository({
      current: {
        readingGroups: [{ portalId: P1, groupId: G1 }],
        evidence: new Map([[P1, unavailable]]),
      },
    })

    const { groups } = await ask(repo, roster([[P1, null]]))

    expect(groups.map((row) => row.groupId)).toEqual([G1])
    expect(groups[0]?.memberPortalIds).toEqual([])
    expect(groups[0]?.kpis.scans.value).toBeNull()
  })

  it('puts readings under no group, and Portals in no group, in the ungrouped row', async () => {
    const repo = fakeRepository({
      current: { cells: [scans(P1, null, 4), scans(P2, G1, 1), scans(P3, null, 2)] },
    })

    const { ungrouped, groups, total } = await ask(
      repo,
      roster([
        [P1, null],
        [P2, G1],
        [P3, null],
        [P4, null],
      ]),
    )

    expect(ungrouped).toHaveLength(1)
    expect(ungrouped[0]?.propertyId).toBe(PROP)
    expect(ungrouped[0]?.memberPortalIds).toEqual([P1, P3, P4])
    expect(ungrouped[0]?.kpis.scans.value).toBe(6)
    expect(groups.map((row) => row.groupId)).toEqual([G1])
    expect(total.portalIds).toEqual([P1, P2, P3, P4])
    expect(total.kpis.scans.value).toBe(7)
  })

  it('has a total that equals the sum of the groups and the ungrouped row', async () => {
    const repo = fakeRepository({
      current: {
        cells: [
          scans(P1, G1, 3),
          scans(P2, G2, 4),
          scans(P3, null, 5),
          opens(P1, G1, 1),
          opens(P3, null, 2),
          notes(P2, G2, 6),
        ],
      },
    })

    const overview = await ask(
      repo,
      roster([
        [P1, G1],
        [P2, G2],
        [P3, null],
      ]),
    )

    const rows = [...overview.groups, ...overview.ungrouped]
    for (const measure of ['scans', 'feedback', 'googleOpens'] as const) {
      expect(overview.total.kpis[measure].value).toBe(
        rows.reduce((sum, row) => sum + (row.kpis[measure].value ?? 0), 0),
      )
    }
  })

  it('never counts a reading for a Portal that is not in the roster', async () => {
    const repo = fakeRepository({
      current: { cells: [scans(P1, null, 2), scans(P4, null, 50)] },
    })

    const { total, ungrouped } = await ask(repo, roster([[P1, null]]))

    expect(total.kpis.scans.value).toBe(2)
    expect(ungrouped[0]?.kpis.scans.value).toBe(2)
  })

  it('does not coerce an unready Portal to zero, and spreads that to its group and the total', async () => {
    const updating = readyEvidence({
      scans: evidence(METRIC_VERSION_IDS.qualifiedScanGoal, {
        state: 'updating',
        verifiedThrough: null,
        availabilityReason: 'consumer_receipt_pending',
      }),
    })
    const repo = fakeRepository({
      current: {
        cells: [scans(P1, G1, 3), scans(P2, G2, 4)],
        evidence: new Map([[P1, updating]]),
      },
    })

    const overview = await ask(
      repo,
      roster([
        [P1, G1],
        [P2, G2],
      ]),
    )

    const scanState = (id: PortalGroupId) =>
      overview.groups.find((row) => row.groupId === id)?.kpis.scans
    expect(scanState(G1)).toMatchObject({
      value: null,
      evidence: { state: 'updating', availabilityReason: 'consumer_receipt_pending' },
    })
    expect(scanState(G2)?.value).toBe(4)
    expect(overview.total.kpis.scans.value).toBeNull()
    expect(overview.properties[0]?.kpis.scans.value).toBeNull()
    expect(
      overview.portals.find((row) => row.portalId === P1)?.kpis.scans.value,
    ).toBeNull()
    // Other measures of the same Portal are unaffected.
    expect(overview.total.kpis.feedback.value).toBe(0)
  })

  it('marks Google opens insufficient for a group when one Portal has unattributed clicks', async () => {
    const unattributed = readyEvidence({
      reviewLinkClicks: evidence(METRIC_VERSION_IDS.portalDestinationClickAnalytics, {
        state: 'insufficient',
        verifiedThrough: null,
        availabilityReason: 'destination_unattributed',
      }),
    })
    const repo = fakeRepository({
      current: {
        cells: [opens(P1, G1, 2), opens(P2, G1, 3)],
        evidence: new Map([[P2, unattributed]]),
      },
    })

    const { groups } = await ask(
      repo,
      roster([
        [P1, G1],
        [P2, G1],
      ]),
    )

    expect(groups[0]?.kpis.googleOpens).toMatchObject({
      value: null,
      evidence: {
        state: 'insufficient_data',
        availabilityReason: 'destination_unattributed',
      },
    })
  })

  it('compares groups against the group each reading sat under in the prior window', async () => {
    const repo = fakeRepository({
      current: { cells: [scans(P1, G1, 9)] },
      prior: { cells: [scans(P1, G2, 6), scans(P2, G1, 3)] },
    })

    const { groups } = await ask(
      repo,
      roster([
        [P1, G1],
        [P2, G1],
      ]),
      { compare: true },
    )

    const g1 = groups.find((row) => row.groupId === G1)
    expect(g1?.kpis.scans).toMatchObject({ value: 9, priorValue: 3, trend: 200 })
    const g2 = groups.find((row) => row.groupId === G2)
    expect(g2?.kpis.scans).toMatchObject({ value: 0, priorValue: 6, trend: -100 })
  })

  it('says a prior window before qualified scans began has no prior figure', async () => {
    const repo = fakeRepository({ by: () => ({ cells: [scans(P1, null, 2)] }) })

    // 30 days ending 2026-09-15 open 08-17; the 30 before them open 07-18, before
    // qualified scans began.
    const { total } = await ask(
      repo,
      roster([[P1, null]]),
      { compare: true },
      new Date('2026-09-15T00:00:00.000Z'),
    )

    expect(total.kpis.scans).toMatchObject({
      priorValue: null,
      trend: null,
      priorUnavailableReason: 'measure_not_yet_counted',
    })
  })

  it('returns an empty overview for no Portals, with a ready zero total', async () => {
    const repo = fakeRepository({})

    const overview = await ask(repo, [])

    expect(overview.portals).toEqual([])
    expect(overview.groups).toEqual([])
    expect(overview.ungrouped).toEqual([])
    expect(overview.properties).toEqual([])
    expect(overview.total.portalIds).toEqual([])
    expect(overview.total.kpis.scans).toMatchObject({
      value: 0,
      evidence: { state: 'ready' },
    })
    expect(repo.readWindow).not.toHaveBeenCalled()
  })

  describe('input validation', () => {
    const run = (input: Partial<GetPortalResultsOverviewInput>) =>
      ask(fakeRepository({}), roster([[P1, null]]), input)

    it('rejects All Time, which has no bounded window to read', async () => {
      await expect(
        run({ timeRange: 'all' as GetPortalResultsOverviewInput['timeRange'] }),
      ).rejects.toThrow('bounded')
    })

    it('rejects a Property whose time zone was not supplied', async () => {
      await expect(run({ properties: [] })).rejects.toThrow('time zone')
    })

    it('rejects a Property listed twice', async () => {
      await expect(
        run({
          properties: [
            { propertyId: PROP, timezone: UTC },
            { propertyId: PROP, timezone: AUCKLAND },
          ],
        }),
      ).rejects.toThrow('more than once')
    })

    it('rejects a Portal listed twice, rather than counting it twice', async () => {
      await expect(
        run({
          portals: roster([
            [P1, null],
            [P1, G1],
          ]),
        }),
      ).rejects.toThrow('more than once')
    })

    it('rejects a Portal outside a single-Property scope', async () => {
      await expect(
        run({
          portals: [{ portalId: P1, propertyId: OTHER_PROP, groupId: null }],
          properties: [{ propertyId: OTHER_PROP, timezone: UTC }],
        }),
      ).rejects.toThrow('outside the requested Property')
    })

    it('allows Portals of several Properties in an Organization scope', async () => {
      await expect(
        run({
          scope: { organizationId: ORG, propertyId: null },
          portals: [
            { portalId: P1, propertyId: PROP, groupId: null },
            { portalId: P2, propertyId: OTHER_PROP, groupId: null },
          ],
          properties: [
            { propertyId: PROP, timezone: UTC },
            { propertyId: OTHER_PROP, timezone: UTC },
          ],
        }),
      ).resolves.toBeDefined()
    })

    it('rejects a roster too large for one read', async () => {
      const tooMany = Array.from({ length: PORTAL_RESULTS_PORTAL_LIMIT + 1 }, (_, i) => ({
        portalId: portalId(`b2000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
        propertyId: PROP,
        groupId: null,
      }))
      await expect(run({ portals: tooMany })).rejects.toThrow('too many Portals')
    })

    it('fails loudly when the store returns no evidence for a Portal', async () => {
      const results: PortalResultsOverviewRepository = {
        readWindow: async () => ({
          computedAt: COMPUTED_AT,
          cells: [],
          readingGroups: [],
          evidence: [],
        }),
      }
      await expect(ask({ results }, roster([[P1, null]]))).rejects.toThrow('no evidence')
    })
  })
})
