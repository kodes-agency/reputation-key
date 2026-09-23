import { describe, expect, it } from 'vitest'
import { effectiveEmailCadence, offeredEmailCadences } from './notification-cadence'

describe('notification email cadence', () => {
  // One Program over up to 250 Portals closes its results in the same hour, so
  // an immediate cadence could send 250 goal emails at once (ADR 0046, amended
  // 2026-09-22).
  it('offers goal email as a daily digest only', () => {
    expect(offeredEmailCadences('recognition')).toEqual(['daily'])
    expect(offeredEmailCadences('workflow_collaboration')).toEqual(['immediate', 'daily'])
    expect(offeredEmailCadences('urgent_operational')).toEqual(['immediate', 'daily'])
  })

  it('delivers a stored cadence the category no longer offers at its default', () => {
    expect(effectiveEmailCadence('recognition', 'immediate')).toBe('daily')
    expect(effectiveEmailCadence('workflow_collaboration', 'immediate')).toBe('immediate')
    expect(effectiveEmailCadence('urgent_operational', undefined)).toBe('immediate')
    expect(effectiveEmailCadence('recognition', undefined)).toBe('daily')
  })
})
