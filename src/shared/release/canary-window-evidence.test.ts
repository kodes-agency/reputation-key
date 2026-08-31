import { describe, expect, it } from 'vitest'
import {
  CANARY_REQUIRED_SIGNAL_CATEGORIES,
  CANARY_THRESHOLD_PROFILE_VERSION,
  canaryThresholdProfileSchema,
} from './canary-window-evidence'
import {
  CANARY_THRESHOLD_PROFILE_AUTHORITY_VERSION,
  parseCanaryThresholdProfile,
} from './canary-threshold-profile'

const DECISION_SHA256 = 'c'.repeat(64)

const SIGNALS = [
  ['application_health', 'canary-a-application-health', 'application_metrics'],
  ['error_rate', 'canary-b-error-rate', 'sentry'],
  ['external_availability', 'canary-c-external-availability', 'external_synthetic'],
  ['latency', 'canary-d-latency', 'application_metrics'],
  ['platform_recovery', 'canary-e-platform-recovery', 'railway_platform'],
  ['privacy', 'canary-f-privacy', 'application_metrics'],
  ['provider_controls', 'canary-g-provider-controls', 'provider_control'],
  ['queue_outbox', 'canary-h-queue-outbox', 'application_metrics'],
  ['release_drift', 'canary-i-release-drift', 'release_controller'],
] as const

function profile(durationMs: number) {
  return {
    version: CANARY_THRESHOLD_PROFILE_VERSION,
    durationMs,
    approvedBy: 'operating-owner:beta-oncall',
    approvedAt: '2026-08-27T12:00:00.000Z',
    decisionRecordSha256: DECISION_SHA256,
    signals: SIGNALS.map(([category, name, source]) => ({
      category,
      name,
      source,
      comparator: 'eq' as const,
      threshold: 0,
      unit: 'events',
      sampleIntervalMs: 60_000,
      thresholdAuthoritySha256: DECISION_SHA256,
    })),
  }
}

describe('canary threshold profile schema export', () => {
  it('covers exactly the nine required signal categories', () => {
    expect([...CANARY_REQUIRED_SIGNAL_CATEGORIES].sort()).toEqual(
      [...SIGNALS.map(([category]) => category)].sort(),
    )
  })

  it('accepts a ratified profile with a positive duration', () => {
    expect(canaryThresholdProfileSchema.safeParse(profile(3_600_000)).success).toBe(true)
  })

  it('still refuses a non-positive observation duration', () => {
    for (const durationMs of [0, -1, -3_600_000]) {
      expect(canaryThresholdProfileSchema.safeParse(profile(durationMs)).success).toBe(
        false,
      )
    }
  })

  it('is the schema the ratification parser validates against', () => {
    // The authority parser must not carry a second, looser definition of a
    // profile: a duration the evidence schema refuses must also be unratifiable.
    const authority = JSON.stringify({
      version: CANARY_THRESHOLD_PROFILE_AUTHORITY_VERSION,
      decisionRecord: 'docs/adr/0059-rel-01-canary-observation-window.md',
      decisionRecordSha256: DECISION_SHA256,
      ratification: {
        state: 'ratified',
        durationMs: 0,
        approvedBy: 'operating-owner:beta-oncall',
        approvedAt: '2026-08-27T12:00:00.000Z',
      },
      signals: SIGNALS.map(([category, name, source]) => ({
        category,
        name,
        source,
        comparator: 'eq',
        threshold: 0,
        unit: 'events',
        sampleIntervalMs: 60_000,
        valuePointer: '/value',
      })),
    })
    const result = parseCanaryThresholdProfile(authority, {
      now: '2026-08-28T00:00:00.000Z',
    })
    expect(result.ok).toBe(false)
  })
})
