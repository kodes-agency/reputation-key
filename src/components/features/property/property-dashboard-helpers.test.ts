import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MetricKPIValue } from '#/contexts/dashboard/application/public-api'
import { KPICard } from './property-dashboard-helpers'

const Icon = () => createElement('svg', { 'aria-hidden': true })

function unavailableMetricKpi(state: 'updating' | 'unavailable'): MetricKPIValue {
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

describe('Property and Staff KPI card', () => {
  it('renders an absent governed metric as Updating without inventing zero', () => {
    const markup = renderToStaticMarkup(
      createElement(KPICard, {
        label: 'Scans',
        kpi: unavailableMetricKpi('updating'),
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
        kpi: unavailableMetricKpi('unavailable'),
        icon: Icon,
      }),
    )

    expect(markup).toContain('Temporarily unavailable')
    expect(markup).not.toContain('>0<')
  })
})
