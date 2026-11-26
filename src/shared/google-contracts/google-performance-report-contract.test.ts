import { describe, expect, it } from 'vitest'
import {
  GOOGLE_PERFORMANCE_ERROR_CODES,
  PROPERTY_PERFORMANCE_PRESETS,
} from './google-performance-report-contract'

describe('Property Google Performance presentation contract', () => {
  it('keeps Performance range independent from Dashboard timeRange', () => {
    expect(PROPERTY_PERFORMANCE_PRESETS).toEqual(['7d', '30d', '90d', '180d'])
  })

  it('freezes safe external error codes and rejects unknown entries', () => {
    expect(GOOGLE_PERFORMANCE_ERROR_CODES).toEqual([
      'rate_limited',
      'provider_timeout',
      'provider_rejected',
      'authorization_stale',
      'temporarily_unavailable',
      'malformed_provider_response',
      'stale_source',
    ])
  })
})
