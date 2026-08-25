import { describe, expect, it } from 'vitest'
import {
  portalMetricAvailabilityDetail,
  portalMetricEvidenceLine,
  portalMetricStateLabel,
} from './portal-metric-evidence-presentation'

const evidence = {
  definitionVersionId: 'version-1',
  state: 'ready' as const,
  verifiedThrough: new Date('2026-08-25T10:15:00.000Z'),
  latestActivity: new Date('2026-08-25T09:05:00.000Z'),
  computedAt: new Date('2026-08-25T10:16:00.000Z'),
  completeness: 1,
  availabilityReason: null,
  correctionHead: null,
  sampleCount: 4,
}

describe('Portal metric evidence presentation', () => {
  it('distinguishes all four manager-facing states', () => {
    expect(portalMetricStateLabel('ready')).toBe('Ready')
    expect(portalMetricStateLabel('updating')).toBe('Updating')
    expect(portalMetricStateLabel('insufficient_data')).toBe('Insufficient data')
    expect(portalMetricStateLabel('temporarily_unavailable')).toBe(
      'Temporarily unavailable',
    )
  })

  it('shows a verified-through time only when one exists', () => {
    expect(portalMetricEvidenceLine(evidence, 'en-GB', 'UTC')).toContain(
      'Data through 25 Aug 2026, 10:15',
    )
    expect(
      portalMetricEvidenceLine(
        {
          ...evidence,
          state: 'updating',
          verifiedThrough: null,
          availabilityReason: 'consumer_receipt_pending',
        },
        'en-GB',
        'UTC',
      ),
    ).toBe('Updating; figures will appear when checks finish.')
  })

  it('turns internal availability reasons into calm manager-facing detail', () => {
    expect(portalMetricAvailabilityDetail('consumer_receipt_pending')).toBe(
      'Recent activity is still processing.',
    )
    expect(portalMetricAvailabilityDetail('projection_missing')).toBe(
      'This data is being repaired.',
    )
    expect(portalMetricAvailabilityDetail('invalid_governed_reading')).toBe(
      'A data quality check needs attention.',
    )
    expect(portalMetricAvailabilityDetail(null)).toBe('—')
  })
})
