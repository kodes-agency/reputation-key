import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  MetricAvailabilityState,
  MetricKPIValue,
  RatingKPIValue,
} from '#/contexts/dashboard/application/public-api'
import { KPICard, RatingKPICard } from './property-dashboard-helpers'

const Icon = () => createElement('svg', { 'aria-hidden': true })

function metricKpi(state: MetricAvailabilityState): MetricKPIValue {
  return {
    value: null,
    priorValue: null,
    trend: null,
    evidence: {
      current: {
        state,
        definitionVersionId: null,
        sampleCount: 0,
        minimumSample: null,
      },
      prior: null,
    },
  }
}

function ratingKpi(overrides: Partial<RatingKPIValue> = {}): RatingKPIValue {
  return {
    value: 4.3,
    priorValue: 4.1,
    comparison: 0.2,
    sampleCount: 12,
    priorSampleCount: 12,
    evidence: {
      definitionVersionId: null,
      state: 'ready',
      verifiedThrough: new Date('2026-08-25T10:15:00.000Z'),
      latestActivity: null,
      computedAt: new Date('2026-08-25T10:16:00.000Z'),
      completeness: 1,
      availabilityReason: null,
      correctionHead: null,
      sampleCount: 12,
    },
    ...overrides,
  }
}

describe('Property and Staff KPI card', () => {
  it('renders an absent governed metric as Updating without inventing zero', () => {
    const markup = renderToStaticMarkup(
      createElement(KPICard, {
        label: 'Scans',
        kpi: metricKpi('updating'),
        icon: Icon,
      }),
    )

    expect(markup).toContain('Updating')
    expect(markup).not.toContain('>0<')
    expect(markup).not.toContain('null')
  })

  it('renders incomplete governed evidence as temporarily unavailable', () => {
    const markup = renderToStaticMarkup(
      createElement(KPICard, {
        label: 'Feedback',
        kpi: metricKpi('temporarily_unavailable'),
        icon: Icon,
      }),
    )

    expect(markup).toContain('Temporarily unavailable')
    expect(markup).not.toContain('>0<')
  })

  it('renders the rating comparison in absolute stars, never a percent', () => {
    const markup = renderToStaticMarkup(
      createElement(RatingKPICard, {
        label: 'Avg Rating',
        kpi: ratingKpi(),
        icon: Icon,
        timeRange: '30d',
      }),
    )

    expect(markup).toContain('+0.2 stars')
    expect(markup).not.toContain('%')
  })

  it('renders an empty period as insufficient data, not 0.0', () => {
    const ready = ratingKpi()
    const empty = {
      ...ready,
      value: null,
      priorValue: null,
      comparison: null,
      sampleCount: 0,
      priorSampleCount: 0,
      evidence: {
        ...ready.evidence,
        state: 'insufficient_data',
        verifiedThrough: null,
        latestActivity: null,
        sampleCount: 0,
      },
    } satisfies RatingKPIValue
    const markup = renderToStaticMarkup(
      createElement(RatingKPICard, {
        label: 'Avg Rating',
        kpi: empty,
        icon: Icon,
        timeRange: '30d',
      }),
    )

    expect(markup).toContain('—')
    expect(markup).toContain('Insufficient data')
    expect(markup).not.toContain('0.0')
  })
})
