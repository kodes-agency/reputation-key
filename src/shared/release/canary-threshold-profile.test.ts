import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CANARY_THRESHOLD_DECISION_RECORD_PATH,
  CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH,
  CANARY_THRESHOLD_PROFILE_AUTHORITY_VERSION,
  canaryThresholdProfileAuthorityJson,
  parseCanaryThresholdProfile,
} from './canary-threshold-profile'

const DECISION_SHA256 = createHash('sha256')
  .update(readFileSync(resolve(CANARY_THRESHOLD_DECISION_RECORD_PATH)))
  .digest('hex')

type MutableSignal = {
  category: string
  name: string
  source: string
  comparator: string
  threshold: number
  unit: string
  sampleIntervalMs: number
  valuePointer: string
}

function signals(): MutableSignal[] {
  return [
    {
      category: 'application_health',
      name: 'canary-application-readiness',
      source: 'application_metrics',
      comparator: 'eq',
      threshold: 0,
      unit: 'degraded sections',
      sampleIntervalMs: 60_000,
      valuePointer: '/degraded/length',
    },
    {
      category: 'error_rate',
      name: 'canary-error-rate',
      source: 'sentry',
      comparator: 'eq',
      threshold: 0,
      unit: 'unresolved new issues',
      sampleIntervalMs: 60_000,
      valuePointer: '/unresolvedNewIssues',
    },
    {
      category: 'external_availability',
      name: 'canary-external-availability',
      source: 'external_synthetic',
      comparator: 'eq',
      threshold: 0,
      unit: 'failed probes',
      sampleIntervalMs: 60_000,
      valuePointer: '/failedProbes',
    },
    {
      category: 'latency',
      name: 'canary-latency-p95',
      source: 'application_metrics',
      comparator: 'lte',
      threshold: 1500,
      unit: 'milliseconds',
      sampleIntervalMs: 60_000,
      valuePointer: '/latency/p95Ms',
    },
    {
      category: 'platform_recovery',
      name: 'canary-platform-recovery',
      source: 'railway_platform',
      comparator: 'eq',
      threshold: 0,
      unit: 'unplanned restarts',
      sampleIntervalMs: 300_000,
      valuePointer: '/unplannedRestarts',
    },
    {
      category: 'privacy',
      name: 'canary-privacy-prohibited-fields',
      source: 'application_metrics',
      comparator: 'eq',
      threshold: 0,
      unit: 'occurrences',
      sampleIntervalMs: 60_000,
      valuePointer: '/privacy/prohibitedFieldOccurrences',
    },
    {
      category: 'provider_controls',
      name: 'canary-provider-control-heads',
      source: 'provider_control',
      comparator: 'eq',
      threshold: 0,
      unit: 'blocked heads',
      sampleIntervalMs: 60_000,
      valuePointer: '/blockedHeads',
    },
    {
      category: 'queue_outbox',
      name: 'canary-queue-outbox-backlog',
      source: 'application_metrics',
      comparator: 'eq',
      threshold: 0,
      unit: 'stalled rows',
      sampleIntervalMs: 60_000,
      valuePointer: '/outbox/stalledCount',
    },
    {
      category: 'release_drift',
      name: 'canary-release-drift',
      source: 'release_controller',
      comparator: 'eq',
      threshold: 0,
      unit: 'identity mismatches',
      sampleIntervalMs: 60_000,
      valuePointer: '/identityMismatches',
    },
  ]
}

function authority(
  overrides: Readonly<{
    signals?: MutableSignal[]
    ratification?: unknown
    decisionRecordSha256?: string
  }> = {},
): string {
  return JSON.stringify({
    version: CANARY_THRESHOLD_PROFILE_AUTHORITY_VERSION,
    decisionRecord: CANARY_THRESHOLD_DECISION_RECORD_PATH,
    decisionRecordSha256: overrides.decisionRecordSha256 ?? DECISION_SHA256,
    ratification: overrides.ratification ?? {
      state: 'ratified',
      durationMs: 3_600_000,
      approvedBy: 'operating-owner:beta-oncall',
      approvedAt: '2026-08-27T12:00:00.000Z',
    },
    signals: overrides.signals ?? signals(),
  })
}

// After the 2026-08-29 ratification recorded in the tracked profile. The
// parser refuses a future-dated approval, so a clock that predates the real
// ratification would reject the very artifact these tests read.
const NOW = '2026-08-30T00:00:00.000Z'

describe('canary threshold profile authority', () => {
  it('rejects a profile missing any required signal category', () => {
    for (const category of [
      'application_health',
      'error_rate',
      'external_availability',
      'queue_outbox',
      'provider_controls',
      'latency',
      'privacy',
      'platform_recovery',
      'release_drift',
    ]) {
      const withoutCategory = signals().filter((signal) => signal.category !== category)
      const result = parseCanaryThresholdProfile(
        authority({ signals: withoutCategory }),
        {
          now: NOW,
        },
      )
      expect(result.ok, category).toBe(false)
      if (result.ok) continue
      expect(result.errors.join('\n')).toContain(
        `missing required canary category ${category}`,
      )
    }
  })

  it('rejects signals that are not in canonical localeCompare name order', () => {
    const reordered = signals()
    const [first, second] = [reordered[0], reordered[1]]
    if (!first || !second) throw new Error('fixture must contain two signals')
    reordered[0] = second
    reordered[1] = first
    const result = parseCanaryThresholdProfile(authority({ signals: reordered }), {
      now: NOW,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain(
      'signal profiles must use canonical name order',
    )
  })

  it('rejects a sample interval longer than the ratified duration, naming the signal index', () => {
    const tooSlow = signals()
    const platformRecovery = tooSlow[4]
    if (!platformRecovery) throw new Error('fixture must contain nine signals')
    tooSlow[4] = { ...platformRecovery, sampleIntervalMs: 7_200_000 }
    const result = parseCanaryThresholdProfile(authority({ signals: tooSlow }), {
      now: NOW,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain(
      'signals.4.sampleIntervalMs: sample interval exceeds the approved observation duration',
    )
  })

  it('restricts every signal to the authoritative source for its category', () => {
    const wrongSource = signals()
    const errorRate = wrongSource[1]
    if (!errorRate) throw new Error('fixture must contain the error-rate signal')
    wrongSource[1] = { ...errorRate, source: 'application_metrics' }
    const result = parseCanaryThresholdProfile(authority({ signals: wrongSource }), {
      now: NOW,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain(
      'source is not authoritative for error_rate',
    )
  })

  it('binds the tracked authority file to the exact decision record digest', () => {
    const tracked = readFileSync(resolve(CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH), 'utf8')
    const result = parseCanaryThresholdProfile(tracked, { now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.authority.decisionRecordSha256).toBe(DECISION_SHA256)
    expect(result.authority.decisionRecord).toBe(CANARY_THRESHOLD_DECISION_RECORD_PATH)
  })

  it('rejects an authority whose decision-record digest drifted from the ADR', () => {
    const result = parseCanaryThresholdProfile(
      authority({ decisionRecordSha256: 'a'.repeat(64) }),
      { now: NOW, decisionRecordSha256: DECISION_SHA256 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain('decision record')
  })

  it('carries the ratified 24-hour window the operating owner agreed', () => {
    const tracked = readFileSync(resolve(CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH), 'utf8')
    const result = parseCanaryThresholdProfile(tracked, { now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toBe('ratified')
    if (result.state !== 'ratified') return
    // 24h. The duration is the whole point of the ratification, so it is
    // asserted exactly rather than merely being present.
    expect(result.profile.durationMs).toBe(86_400_000)
    expect(result.profile.approvedBy).toBe('Bozhidar Denev')
  })

  it('rejects an unratified profile whose approver is a placeholder identity', () => {
    for (const approvedBy of ['TBD', 'pending', 'engineering', '<operating owner>']) {
      const result = parseCanaryThresholdProfile(
        authority({
          ratification: {
            state: 'ratified',
            durationMs: 3_600_000,
            approvedBy,
            approvedAt: '2026-08-27T12:00:00.000Z',
          },
        }),
        { now: NOW },
      )
      expect(result.ok, approvedBy).toBe(false)
      if (result.ok) continue
      expect(result.errors.join('\n')).toContain('placeholder')
    }
  })

  it('rejects a ratification dated in the future', () => {
    const result = parseCanaryThresholdProfile(
      authority({
        ratification: {
          state: 'ratified',
          durationMs: 3_600_000,
          approvedBy: 'operating-owner:beta-oncall',
          approvedAt: '2026-09-01T00:00:00.000Z',
        },
      }),
      { now: NOW },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain('must not be dated in the future')
  })

  it('derives an evidence-shaped profile once an operating owner has ratified it', () => {
    const result = parseCanaryThresholdProfile(authority(), { now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok || result.state !== 'ratified')
      throw new Error('expected a ratified profile')
    expect(result.profile.durationMs).toBe(3_600_000)
    expect(result.profile.approvedBy).toBe('operating-owner:beta-oncall')
    expect(result.profile.signals).toHaveLength(9)
    for (const signal of result.profile.signals) {
      // Every threshold in the profile is authorised by ADR 0059 and nothing
      // else, so a silent ADR edit invalidates every signal at once.
      expect(signal.thresholdAuthoritySha256).toBe(DECISION_SHA256)
    }
  })

  it('round-trips the tracked authority document through its canonical serializer', () => {
    const tracked = readFileSync(resolve(CANARY_THRESHOLD_PROFILE_AUTHORITY_PATH), 'utf8')
    const result = parseCanaryThresholdProfile(tracked, { now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(canaryThresholdProfileAuthorityJson(result.authority)).toBe(tracked)
  })
})
