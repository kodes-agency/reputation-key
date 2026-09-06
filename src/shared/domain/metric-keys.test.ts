import { describe, it, expect } from 'vitest'
import { METRIC_KEYS } from './metric-keys'

describe('metric-keys', () => {
  describe('MetricKey type', () => {
    it('defines analytics and beta-safe governed metric keys', () => {
      expect(METRIC_KEYS).toEqual([
        'portal.scan',
        'portal.rating',
        'portal.qualified_scan',
        'portal.rating_count',
        'portal.rating_average',
        'portal.feedback',
        'portal.review_link_click',
        'property.review',
        'portal.content_review.completed',
        'portal.configuration_completeness',
        'portal.approved_destination_ratio',
      ])
    })
  })
})
