// The Portals overview's results for tests and stories: Avela Resort, last 30
// days on 30 Sep (Europe/Sofia), with the figures boards 01 and 10 print. One
// builder per kind of row, so a test names only the figure it cares about.
import type {
  PortalResultsGroupRow,
  PortalResultsMeasures,
  PortalResultsOverview,
  PortalResultsPortalRow,
  PortalResultsPropertyRow,
  PortalResultsUngroupedRow,
} from '#/contexts/reporting/application/public-api'
import { portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import {
  resultsCount,
  resultsEvidence,
} from '../portal-analytics/portal-results-stories-data'

const PROPERTY = propertyId('prop-1')

export type Figures = Readonly<{
  scans: number
  ratings: number
  /** Null is an average the sample is too small to show. */
  average: number | null
  googleOpens: number
  notes: number
}>

/** The five measures of a row that is ready. */
export function measuresOf(figures: Figures): PortalResultsMeasures {
  const { scans, ratings, average, googleOpens, notes } = figures
  return {
    kpis: {
      scans: resultsCount(scans, null),
      ratings: resultsCount(ratings, null),
      avgRating:
        average === null
          ? {
              value: null,
              priorValue: null,
              comparison: null,
              sampleCount: ratings,
              priorSampleCount: 0,
              evidence: resultsEvidence({
                state: 'insufficient_data',
                availabilityReason: 'below_minimum_sample',
                verifiedThrough: null,
                sampleCount: ratings,
              }),
            }
          : {
              value: average,
              priorValue: null,
              comparison: null,
              comparisonWithheld: null,
              sampleCount: ratings,
              priorSampleCount: 0,
              evidence: resultsEvidence({ sampleCount: ratings }),
            },
      feedback: resultsCount(notes, null),
      googleOpens: resultsCount(googleOpens, null),
    },
    engagementFunnel: { qualifiedScans: scans, ratings, googleOpens },
  }
}

/** Every measure still being processed: no figure, never a zero. */
export function updatingMeasures(): PortalResultsMeasures {
  const notYet = {
    value: null,
    priorValue: null,
    trend: null,
    evidence: resultsEvidence({
      state: 'updating',
      verifiedThrough: null,
      availabilityReason: 'consumer_receipt_pending',
    }),
  }
  return {
    kpis: {
      scans: notYet,
      ratings: notYet,
      avgRating: {
        value: null,
        priorValue: null,
        comparison: null,
        sampleCount: 0,
        priorSampleCount: 0,
        evidence: notYet.evidence,
      },
      feedback: notYet,
      googleOpens: notYet,
    },
    engagementFunnel: null,
  }
}

export const portalResultsRow = (
  id: string,
  group: string | null,
  measures: PortalResultsMeasures,
): PortalResultsPortalRow => ({
  portalId: portalId(id),
  propertyId: PROPERTY,
  groupId: group === null ? null : portalGroupId(group),
  ...measures,
})

export const groupResultsRow = (
  group: string,
  members: readonly string[],
  measures: PortalResultsMeasures,
  contributing: readonly string[] = members,
): PortalResultsGroupRow => ({
  propertyId: PROPERTY,
  groupId: portalGroupId(group),
  memberPortalIds: members.map(portalId),
  contributingPortalIds: contributing.map(portalId),
  ...measures,
})

export const ungroupedResultsRow = (
  members: readonly string[],
  measures: PortalResultsMeasures,
): PortalResultsUngroupedRow => ({
  propertyId: PROPERTY,
  memberPortalIds: members.map(portalId),
  contributingPortalIds: members.map(portalId),
  ...measures,
})

const WINDOW = {
  startAt: new Date('2026-08-31T21:00:00.000Z'),
  endAt: new Date('2026-09-30T11:00:00.000Z'),
}
const PRIOR_WINDOW = {
  startAt: new Date('2026-08-01T21:00:00.000Z'),
  endAt: new Date('2026-08-31T21:00:00.000Z'),
}

export const propertyResultsRow = (
  portals: readonly string[],
  measures: PortalResultsMeasures,
  options: Readonly<{ compare?: boolean }> = {},
): PortalResultsPropertyRow => ({
  propertyId: PROPERTY,
  timezone: 'Europe/Sofia',
  period: WINDOW,
  comparePeriod: options.compare === false ? null : PRIOR_WINDOW,
  localDays: {
    start: '2026-09-01',
    end: '2026-09-30',
    compareStart: options.compare === false ? null : '2026-08-02',
    compareEnd: options.compare === false ? null : '2026-08-31',
  },
  portalIds: portals.map(portalId),
  ...measures,
})

/** Avela Resort as boards 01 and 10 print it (the draft Pool bar has no reading). */
export const POOL_TERRACE = {
  scans: 412,
  ratings: 118,
  average: 4.4,
  googleOpens: 64,
  notes: 9,
}
export const SPA = { scans: 286, ratings: 91, average: 4.6, googleOpens: 52, notes: 4 }
export const RECEPTION = {
  scans: 520,
  ratings: 140,
  average: 4.5,
  googleOpens: 77,
  notes: 12,
}
export const GUEST_ROOMS = {
  scans: 38,
  ratings: 4,
  average: null,
  googleOpens: 2,
  notes: 0,
}
export const OLIVE = { scans: 351, ratings: 97, average: 4.2, googleOpens: 41, notes: 11 }
const POOL_SIDE = { scans: 698, ratings: 209, average: 4.5, googleOpens: 116, notes: 13 }
const FRONT = { scans: 558, ratings: 144, average: 4.5, googleOpens: 79, notes: 12 }
const PROPERTY_TOTAL = {
  scans: 1607,
  ratings: 450,
  average: 4.4,
  googleOpens: 236,
  notes: 36,
}

export function avelaResults(): PortalResultsOverview {
  const property = propertyResultsRow(
    ['p-terrace', 'p-spa', 'p-bar', 'p-reception', 'p-rooms', 'p-olive'],
    measuresOf(PROPERTY_TOTAL),
  )
  return {
    qualifiedScansSince: new Date('2026-08-01T00:00:00.000Z'),
    thresholds: { averageMinSample: 5, comparisonMinSample: 10 },
    properties: [property],
    portals: [
      portalResultsRow('p-terrace', 'group-pool', measuresOf(POOL_TERRACE)),
      portalResultsRow('p-spa', 'group-pool', measuresOf(SPA)),
      portalResultsRow(
        'p-bar',
        'group-pool',
        measuresOf({
          ...POOL_TERRACE,
          scans: 0,
          ratings: 0,
          average: null,
          googleOpens: 0,
          notes: 0,
        }),
      ),
      portalResultsRow('p-reception', 'group-front', measuresOf(RECEPTION)),
      portalResultsRow('p-rooms', 'group-front', measuresOf(GUEST_ROOMS)),
      portalResultsRow('p-olive', null, measuresOf(OLIVE)),
    ],
    groups: [
      groupResultsRow(
        'group-pool',
        ['p-terrace', 'p-spa', 'p-bar'],
        measuresOf(POOL_SIDE),
      ),
      groupResultsRow('group-front', ['p-reception', 'p-rooms'], measuresOf(FRONT)),
    ],
    ungrouped: [ungroupedResultsRow(['p-olive'], measuresOf(OLIVE))],
    total: {
      portalIds: property.portalIds,
      ...measuresOf(PROPERTY_TOTAL),
    },
  }
}
