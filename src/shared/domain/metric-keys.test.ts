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
    it('property scope allows only beta-safe first-party workflow metrics', () => {
      expect(VALID_SCOPE_METRIC_KEYS.property).toEqual([
        'portal.content_review.completed',
        'portal.configuration_completeness',
        'portal.approved_destination_ratio',
      ])
    })

    it('individual portal scope is excluded from beta goals', () => {
      expect(VALID_SCOPE_METRIC_KEYS.portal).toEqual([])
    })

    it('portal_group scope allows beta-safe first-party workflow metrics', () => {
      expect(VALID_SCOPE_METRIC_KEYS.portal_group).toEqual([
        'portal.content_review.completed',
        'portal.configuration_completeness',
        'portal.approved_destination_ratio',
      ])
    })

    it('isValidMetricKeyForScope returns true for a governed pair', () => {
      expect(
        isValidMetricKeyForScope('property', 'portal.configuration_completeness'),
      ).toBe(true)
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
    })

    it('defaults to AVG for rating metrics', () => {
      expect(getDefaultAggregation('portal.rating')).toBe('avg')
      expect(getDefaultAggregation('property.review')).toBe('avg')
    })
  })
})
