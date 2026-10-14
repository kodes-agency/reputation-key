import { describe, expect, it } from 'vitest'
import {
  findMetricVersionById,
  METRIC_VERSION_IDS,
  type GovernedMetricVersion,
} from './metric-registry'
import { goalVersionIsUsable } from './goal-metric-version-usable'

const governed = findMetricVersionById(METRIC_VERSION_IDS.qualifiedScanGoal)
if (!governed) throw new Error('The qualified scan goal version is not in the registry.')

// A month after the version took effect (1 Aug 2026, 00:00 UTC).
const SEPTEMBER = {
  periodStart: new Date('2026-09-01T00:00:00.000Z'),
  periodEnd: new Date('2026-10-01T00:00:00.000Z'),
}

const query = (patch: Partial<Parameters<typeof goalVersionIsUsable>[1]> = {}) => ({
  metricKey: 'portal.qualified_scan' as const,
  subjectKind: 'portal' as const,
  ...SEPTEMBER,
  ...patch,
})

/** The registry's version with one fact changed, the way a retired or limited one reads. */
function changed(
  definition: Partial<GovernedMetricVersion['definition']> = {},
  version: Record<string, unknown> = {},
): GovernedMetricVersion {
  return {
    definition: { ...governed!.definition, ...definition },
    version: { ...governed!.version, ...version },
  }
}

describe('whether a governed metric version may answer a goal for a month', () => {
  it.each(['property', 'portal_group', 'portal'] as const)(
    'answers for a %s in a month after it took effect',
    (subjectKind) => {
      expect(goalVersionIsUsable(governed, query({ subjectKind }))).toBe(true)
    },
  )

  it('answers for the month it took effect in, from its first instant', () => {
    expect(
      goalVersionIsUsable(
        governed,
        query({
          periodStart: governed.version.effectiveFrom,
          periodEnd: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ),
    ).toBe(true)
  })

  it('does not answer for a month that began before it took effect', () => {
    const early = new Date(governed.version.effectiveFrom.getTime() - 1)

    expect(goalVersionIsUsable(governed, query({ periodStart: early }))).toBe(false)
  })

  it('does not answer for a month that ends after it stopped being in effect', () => {
    const limited = changed({}, { effectiveTo: new Date('2026-09-15T00:00:00.000Z') })

    expect(goalVersionIsUsable(limited, query())).toBe(false)
  })

  it('answers for a month that ends exactly when it stops being in effect', () => {
    const limited = changed({}, { effectiveTo: SEPTEMBER.periodEnd })

    expect(goalVersionIsUsable(limited, query())).toBe(true)
  })

  it.each(['draft', 'retired'] as const)('does not answer once it is %s', (status) => {
    expect(goalVersionIsUsable(changed({ lifecycleStatus: status }), query())).toBe(false)
  })

  it('does not answer for a measure other than the one asked for', () => {
    expect(
      goalVersionIsUsable(governed, query({ metricKey: 'portal.rating_count' })),
    ).toBe(false)
  })

  it('does not answer a goal when goals are not a permitted consumer', () => {
    const analyticsOnly = changed({}, { permittedConsumers: ['portal_analytics'] })

    expect(goalVersionIsUsable(analyticsOnly, query())).toBe(false)
  })

  it('does not answer for a kind of subject it does not allow', () => {
    const propertyOnly = changed({}, { allowedScopes: ['property'] })

    expect(goalVersionIsUsable(propertyOnly, query({ subjectKind: 'portal' }))).toBe(
      false,
    )
    expect(goalVersionIsUsable(propertyOnly, query({ subjectKind: 'property' }))).toBe(
      true,
    )
  })

  it('never answers a version that could decide on a person', () => {
    expect(
      goalVersionIsUsable(changed({}, { employmentDecisionEligible: true }), query()),
    ).toBe(false)
  })
})
