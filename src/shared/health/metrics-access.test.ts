// BQC-7.2 — the /api/health/metrics operator-token gate. Every denial path
// maps to 404 (not 403) at the route; this pins the allow/deny matrix.
import { describe, expect, it } from 'vitest'
import { isMetricsAuthorized } from './metrics-access'

const TOKEN = 'ops-metrics-token-0123456789abcdef0123456789'

const headers = (init: Record<string, string> = {}) => new Headers(init)

describe('isMetricsAuthorized', () => {
  it('denies when OPS_METRICS_TOKEN is not configured (endpoint stays dark)', () => {
    expect(isMetricsAuthorized(headers({ 'x-ops-token': TOKEN }), undefined)).toBe(false)
  })

  it('denies when no credential is presented', () => {
    expect(isMetricsAuthorized(headers(), TOKEN)).toBe(false)
  })

  it('denies a wrong x-ops-token', () => {
    expect(isMetricsAuthorized(headers({ 'x-ops-token': 'wrong-token' }), TOKEN)).toBe(
      false,
    )
  })

  it('denies a wrong Bearer token', () => {
    expect(
      isMetricsAuthorized(headers({ authorization: 'Bearer wrong-token' }), TOKEN),
    ).toBe(false)
  })

  it('denies a token that only shares a prefix (no prefix matching)', () => {
    expect(
      isMetricsAuthorized(headers({ 'x-ops-token': TOKEN.slice(0, -1) }), TOKEN),
    ).toBe(false)
  })

  it('allows the configured x-ops-token', () => {
    expect(isMetricsAuthorized(headers({ 'x-ops-token': TOKEN }), TOKEN)).toBe(true)
  })

  it('allows Authorization: Bearer <token>', () => {
    expect(
      isMetricsAuthorized(headers({ authorization: `Bearer ${TOKEN}` }), TOKEN),
    ).toBe(true)
  })

  it('ignores a non-Bearer authorization scheme', () => {
    expect(isMetricsAuthorized(headers({ authorization: `Basic ${TOKEN}` }), TOKEN)).toBe(
      false,
    )
  })
})
