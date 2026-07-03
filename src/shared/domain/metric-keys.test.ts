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
    it('defines all five known metric keys', () => {
      expect(METRIC_KEYS).toEqual([
        'portal.scan',
        'portal.rating',
        'portal.feedback',
        'portal.review_link_click',
        'property.review',
      ])
    })
  })

  describe('AggregationFunction type', () => {
    it('defines all four aggregation functions', () => {
      expect(AGGREGATION_FUNCTIONS).toEqual(['sum', 'count', 'max', 'avg'])
    })
  })

  describe('scope → metric key validation', () => {
    it('property scope allows the three goal-eligible keys', () => {
      expect(VALID_SCOPE_METRIC_KEYS.property).toEqual([
        'portal.scan',
        'portal.rating',
        'property.review',
      ])
    })

    it('portal scope allows scans and ratings only', () => {
      expect(VALID_SCOPE_METRIC_KEYS.portal).toEqual(['portal.scan', 'portal.rating'])
    })

    it('portal_group scope allows scans and ratings only', () => {
      expect(VALID_SCOPE_METRIC_KEYS.portal_group).toEqual([
        'portal.scan',
        'portal.rating',
      ])
    })

    it('isValidMetricKeyForScope returns true for valid pair', () => {
      expect(isValidMetricKeyForScope('property', 'property.review')).toBe(true)
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
