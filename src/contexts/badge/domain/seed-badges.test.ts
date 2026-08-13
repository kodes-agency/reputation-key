import { describe, expect, it } from 'vitest'
import { SYSTEM_BADGE_DEFINITIONS } from './seed-badges'

const SAFE_METRICS = new Set([
  'portal.content_review.completed',
  'portal.configuration_completeness',
  'portal.approved_destination_ratio',
])

describe('governed recognition badge seeds', () => {
  it('contains only positive portal-group definitions backed by beta-safe metrics', () => {
    expect(SYSTEM_BADGE_DEFINITIONS.length).toBeGreaterThan(0)
    for (const definition of SYSTEM_BADGE_DEFINITIONS) {
      expect(definition.targetScope).toBe('portal_group')
      expect(SAFE_METRICS.has(definition.criteria.metricKey)).toBe(true)
      expect(definition.criteria.operator).toBe('>=')
      expect(definition.criteria.threshold).toBeGreaterThanOrEqual(0)
    }
  })

  it('does not expose review, rating, mention, scan, click, Google, AI, or individual badges', () => {
    expect(JSON.stringify(SYSTEM_BADGE_DEFINITIONS).toLowerCase()).not.toMatch(
      /first review|rating|mention|scan|click|google|sentiment|individual|employee|staff/,
    )
  })
})
