import { describe, expect, it } from 'vitest'
import {
  formatEvidenceTime,
  metricAvailabilityDetail,
  metricEvidenceLine,
  metricStateLabel,
} from './metric-availability-presentation'

const evidence = {
  state: 'ready' as const,
  dataThrough: new Date('2026-08-25T10:15:00.000Z'),
}

describe('Metric availability presentation', () => {
  it('distinguishes all four manager-facing states', () => {
    expect(metricStateLabel('ready')).toBe('Ready')
    expect(metricStateLabel('updating')).toBe('Updating')
    expect(metricStateLabel('insufficient_data')).toBe('Insufficient data')
    expect(metricStateLabel('temporarily_unavailable')).toBe('Temporarily unavailable')
  })

  it('shows a data-through time only when one exists', () => {
    expect(metricEvidenceLine(evidence, 'en-GB', 'UTC')).toContain(
      'Data through 25 Aug 2026, 10:15',
    )
    expect(
      metricEvidenceLine(
        {
          ...evidence,
          state: 'updating',
          dataThrough: null,
        },
        'en-GB',
        'UTC',
      ),
    ).toBe('Updating; figures will appear when checks finish.')
  })

  it('formats a data-through time identically without an ambient locale or zone', () => {
    // The property dashboard is server-rendered: an ambient locale or timezone
    // makes the server and the browser disagree and React fails hydration.
    expect(formatEvidenceTime(evidence.dataThrough)).toBe('Aug 25, 2026, 10:15 AM UTC')
    expect(formatEvidenceTime(null)).toBe('—')
  })

  it('labels anonymous lifetime evidence without inventing a data-through time', () => {
    expect(
      metricEvidenceLine({
        ...evidence,
        basis: 'anonymous_lifetime',
        dataThrough: null,
      }),
    ).toBe('All-time aggregate')
  })

  it('turns internal availability reasons into calm manager-facing detail', () => {
    expect(metricAvailabilityDetail('consumer_receipt_pending')).toBe(
      'Recent activity is still processing.',
    )
    expect(metricAvailabilityDetail('projection_missing')).toBe(
      'This data is being repaired.',
    )
    expect(metricAvailabilityDetail('invalid_governed_reading')).toBe(
      'A data quality check needs attention.',
    )
    expect(metricAvailabilityDetail(null)).toBe('—')
  })
})
