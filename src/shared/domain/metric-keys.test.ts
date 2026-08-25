import { describe, it, expect } from 'vitest'
import {
  METRIC_KEYS,
  AGGREGATION_FUNCTIONS,
  VALID_SCOPE_METRIC_KEYS,
  VALID_METRIC_AGGREGATIONS,
  isValidMetricKeyForScope,
  isValidAggregationForMetric,
  getDefaultAggregation,
} from './metric-keys'

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

  describe('AggregationFunction type', () => {
    it('defines all four aggregation functions', () => {
      expect(AGGREGATION_FUNCTIONS).toEqual(['sum', 'count', 'max', 'avg'])
    })
  })

  describe('scope → metric key validation', () => {
    it('property scope allows only the three governed Guest Gateway metrics', () => {
      expect(VALID_SCOPE_METRIC_KEYS.property).toEqual([
        'portal.qualified_scan',
        'portal.rating_count',
        'portal.rating_average',
      ])
    })

    it('individual Portal scope supports all three Goal measures', () => {
      expect(VALID_SCOPE_METRIC_KEYS.portal).toEqual([
        'portal.qualified_scan',
        'portal.rating_count',
        'portal.rating_average',
      ])
    })

    it('portal_group scope supports all three Goal measures', () => {
      expect(VALID_SCOPE_METRIC_KEYS.portal_group).toEqual([
        'portal.qualified_scan',
        'portal.rating_count',
        'portal.rating_average',
      ])
    })

    it('isValidMetricKeyForScope returns true for a governed pair', () => {
      expect(isValidMetricKeyForScope('property', 'portal.rating_average')).toBe(true)
    })

    it('isValidMetricKeyForScope returns false for invalid pair', () => {
      expect(isValidMetricKeyForScope('portal_group', 'property.review')).toBe(false)
    })
  })

  describe('metric key → aggregation validation', () => {
    it('portal.scan allows SUM and COUNT', () => {
      expect(VALID_METRIC_AGGREGATIONS['portal.scan']).toEqual(['sum', 'count'])
    })

    it('portal.rating allows COUNT, MAX, AVG', () => {
      expect(VALID_METRIC_AGGREGATIONS['portal.rating']).toEqual(['count', 'max', 'avg'])
    })

    it('pins each governed Goal metric to one aggregation', () => {
      expect(VALID_METRIC_AGGREGATIONS['portal.qualified_scan']).toEqual(['sum'])
      expect(VALID_METRIC_AGGREGATIONS['portal.rating_count']).toEqual(['sum'])
      expect(VALID_METRIC_AGGREGATIONS['portal.rating_average']).toEqual(['avg'])
    })

    it('portal.feedback allows SUM and COUNT', () => {
      expect(VALID_METRIC_AGGREGATIONS['portal.feedback']).toEqual(['sum', 'count'])
    })

    it('portal.review_link_click allows SUM and COUNT', () => {
      expect(VALID_METRIC_AGGREGATIONS['portal.review_link_click']).toEqual([
        'sum',
        'count',
      ])
    })

    it('property.review allows COUNT, AVG, MAX', () => {
      expect(VALID_METRIC_AGGREGATIONS['property.review']).toEqual([
        'count',
        'avg',
        'max',
      ])
    })

    it('isValidAggregationForMetric returns true for valid pair', () => {
      expect(isValidAggregationForMetric('portal.scan', 'sum')).toBe(true)
    })

    it('isValidAggregationForMetric returns false for invalid pair', () => {
      expect(isValidAggregationForMetric('portal.scan', 'avg')).toBe(false)
    })
  })

  describe('default aggregation', () => {
    it('defaults to SUM for count-based keys', () => {
      expect(getDefaultAggregation('portal.scan')).toBe('sum')
      expect(getDefaultAggregation('portal.feedback')).toBe('sum')
      expect(getDefaultAggregation('portal.review_link_click')).toBe('sum')
      expect(getDefaultAggregation('portal.qualified_scan')).toBe('sum')
      expect(getDefaultAggregation('portal.rating_count')).toBe('sum')
    })

    it('defaults to AVG for rating metrics', () => {
      expect(getDefaultAggregation('portal.rating')).toBe('avg')
      expect(getDefaultAggregation('property.review')).toBe('avg')
      expect(getDefaultAggregation('portal.rating_average')).toBe('avg')
    })
  })
})
