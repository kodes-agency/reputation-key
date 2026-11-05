import { describe, it, expect } from 'vitest'
import {
  METRIC_DEFINITIONS,
  METRIC_VERSION_IDS,
  findMetricVersionById,
} from './metric-registry'

describe('MetricRegistry', () => {
  describe('catalogue', () => {
    it('keeps Google, solicitation and private-response sources out of Goals', () => {
      const blockedSources = new Set([
        'google_property_derivative',
        'review_solicitation_analytics_only',
        'first_party_guest_private',
      ])
      for (const { versions } of METRIC_DEFINITIONS) {
        for (const version of versions) {
          if (!version.permittedConsumers.includes('goal')) continue
          expect(
            version.sourcePolicyAllowlist.filter((source) => blockedSources.has(source)),
            version.id,
          ).toEqual([])
        }
      }
    })

    it('permits no retired consumer on any version', () => {
      // Badge and Leaderboard are retired contexts (root CONTEXT.md). Re-admitting
      // either as a metric consumer needs its own review, not a re-seed of old data.
      const retired: readonly string[] = ['badge', 'leaderboard']
      const permitted = METRIC_DEFINITIONS.flatMap(({ versions }) =>
        versions.flatMap((version) => version.permittedConsumers),
      )

      expect(permitted.filter((consumer) => retired.includes(consumer))).toEqual([])
    })

    it('admits all five Portal results measures at Portal, Group and Property scope', () => {
      // Owner decision 2 (2026-09-30): group rows, group pages and totals show
      // all five measures, so no measure may be Portal-only in the registry.
      const resultsMeasures = [
        METRIC_VERSION_IDS.qualifiedScanGoal,
        METRIC_VERSION_IDS.portalRatingCountGoal,
        METRIC_VERSION_IDS.portalRatingAverageGoal,
        METRIC_VERSION_IDS.portalDestinationClickAnalytics,
        METRIC_VERSION_IDS.portalFeedbackAnalytics,
      ]

      for (const versionId of resultsMeasures) {
        const governed = findMetricVersionById(versionId)
        expect(governed, versionId).not.toBeNull()
        const scopes = governed?.version.allowedScopes ?? []
        expect([...scopes].sort(), versionId).toEqual([
          'portal',
          'portal_group',
          'property',
        ])
      }
    })

    it.each([
      '11111111-1111-4111-8111-111111111101',
      '11111111-1111-4111-8111-111111112101',
      '11111111-1111-4111-8111-111111111102',
      '11111111-1111-4111-8111-111111112102',
      '11111111-1111-4111-8111-111111113102',
      '11111111-1111-4111-8111-111111111103',
      '11111111-1111-4111-8111-111111112103',
    ])('refuses retired workflow version %s for new readings', (versionId) => {
      expect(findMetricVersionById(versionId)).toBeNull()
    })

    it('keeps notes and destination actions private to Portal analytics', () => {
      // Widening the scope is not widening the audience.
      const widened = [
        METRIC_VERSION_IDS.portalDestinationClickAnalytics,
        METRIC_VERSION_IDS.portalFeedbackAnalytics,
      ]
      for (const versionId of widened) {
        expect(findMetricVersionById(versionId)?.version.permittedConsumers).toEqual([
          'portal_analytics',
        ])
      }
    })
  })
})

describe('staff self metric audience', () => {
  it('permits only numeric own-Portal reads, with worker linkage and no employment use', () => {
    const allowed = [
      METRIC_VERSION_IDS.qualifiedScanGoal,
      METRIC_VERSION_IDS.portalRatingAnalytics,
      METRIC_VERSION_IDS.portalRatingCountGoal,
      METRIC_VERSION_IDS.portalRatingAverageGoal,
    ]
    const versions = METRIC_DEFINITIONS.flatMap((entry) => entry.versions).filter(
      (version) => version.permittedConsumers.includes('staff_self'),
    )
    expect(versions.map((version) => version.id).sort()).toEqual([...allowed].sort())
    for (const id of allowed) {
      const metric = findMetricVersionById(id)!
      expect(metric.definition.workerDataFlag).toBe(true)
      expect(metric.version.employmentDecisionEligible).toBe(false)
    }
  })
})
