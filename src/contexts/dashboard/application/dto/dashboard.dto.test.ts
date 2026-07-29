// Dashboard context — DTO validation tests
import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import {
  getDashboardDataDto,
  getPortalAnalyticsDto,
  timeRangePreset,
} from './dashboard.dto'

describe('timeRangePreset', () => {
  it.each(['7d', '30d', '60d', '90d', 'all'])('accepts %s', (val) => {
    expect(() => timeRangePreset.parse(val)).not.toThrow()
  })

  it('rejects invalid time range', () => {
    expect(() => timeRangePreset.parse('1d')).toThrow(ZodError)
    expect(() => timeRangePreset.parse('')).toThrow(ZodError)
  })
})

describe('getDashboardDataDto', () => {
  it('parses valid input with portalId', () => {
    const result = getDashboardDataDto.parse({
      propertyId: 'a0000000-0000-4000-8000-000000000001',
      portalId: 'b0000000-0000-4000-8000-000000000001',
      timeRange: '30d',
    })
    expect(result.propertyId).toBe('a0000000-0000-4000-8000-000000000001')
    expect(result.portalId).toBe('b0000000-0000-4000-8000-000000000001')
  })

  it('parses valid input without portalId', () => {
    const result = getDashboardDataDto.parse({
      propertyId: 'a0000000-0000-4000-8000-000000000001',
    })
    expect(result.portalId).toBeUndefined()
    expect(result.timeRange).toBe('all') // default
  })

  it('rejects missing propertyId', () => {
    expect(() => getDashboardDataDto.parse({})).toThrow(ZodError)
  })

  it('rejects invalid UUID for propertyId', () => {
    expect(() => getDashboardDataDto.parse({ propertyId: 'not-a-uuid' })).toThrow(
      ZodError,
    )
  })
})

describe('getPortalAnalyticsDto', () => {
  it('parses valid input', () => {
    const result = getPortalAnalyticsDto.parse({
      propertyId: 'a0000000-0000-4000-8000-000000000001',
      portalId: 'b0000000-0000-4000-8000-000000000001',
      timeRange: '7d',
    })
    expect(result.propertyId).toBe('a0000000-0000-4000-8000-000000000001')
    expect(result.portalId).toBe('b0000000-0000-4000-8000-000000000001')
  })

  it('requires portalId', () => {
    expect(() =>
      getPortalAnalyticsDto.parse({
        propertyId: 'a0000000-0000-0000-0000-000000000001',
      }),
    ).toThrow(ZodError)
  })

  it('defaults timeRange to all', () => {
    const result = getPortalAnalyticsDto.parse({
      propertyId: 'a0000000-0000-4000-8000-000000000001',
      portalId: 'b0000000-0000-4000-8000-000000000001',
    })
    expect(result.timeRange).toBe('all')
  })
})
