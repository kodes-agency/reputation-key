import { describe, expect, it } from 'vitest'
import {
  canaryWindowDependencyDigests,
  canonicalCanaryWindowEvidence,
  parseCanaryWindowEvidence,
  type CanaryThresholdProfile,
} from './canary-window-evidence'
import {
  observeCanaryWindow,
  type CanarySampleReader,
  type CanarySignalRead,
} from './canary-sampler'
import { releaseEvidenceSha256 } from './candidate-bound-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from './railway-deployment-profile'

const DECISION_RECORD = '# ADR 0059 — canary observation window\n'
const DECISION_SHA256 = releaseEvidenceSha256(DECISION_RECORD)
const RELEASE_SHA = 'a'.repeat(40)
const MANIFEST_SHA256 = 'b'.repeat(64)
const CONFIGURATION_HEAD = '{"capabilityPolicy":"cap-1","routingPolicy":"route-1"}\n'

const CANDIDATE = {
  releaseSha: RELEASE_SHA,
  releaseManifestSha256: MANIFEST_SHA256,
  cell: 'us',
  environment: 'cell-us',
  deploymentProfile: 'production',
  projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
  projectId: 'project-id',
  environmentId: 'environment-id',
  appOrigin: 'https://us.reputationkey.app',
} as const

const SIGNAL_SHAPE = [
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

const PROFILE: CanaryThresholdProfile = {
  version: 'repkey-canary-threshold-profile-1',
  durationMs: 300_000,
  approvedBy: 'operating-owner:beta-oncall',
  approvedAt: '2026-08-27T12:00:00.000Z',
  decisionRecordSha256: DECISION_SHA256,
  signals: SIGNAL_SHAPE.map(([category, name, source]) => ({
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

const READ_PLAN: readonly CanarySignalRead[] = PROFILE.signals.map((signal) => ({
  name: signal.name,
  category: signal.category,
  source: signal.source,
  valuePointer: '/value',
  sampleIntervalMs: signal.sampleIntervalMs,
}))

const STARTED_AT = '2026-08-28T00:00:00.000Z'
const CAPTURED_AT = '2026-08-28T00:10:00.000Z'

const healthyRead: CanarySampleReader = async (request) => ({
  ok: true,
  value: 0,
  rawSample: `{"at":"${request.scheduledAt}","value":0}\n`,
  identity: { releaseSha: RELEASE_SHA, releaseManifestSha256: MANIFEST_SHA256 },
  configurationHead: CONFIGURATION_HEAD,
})

function input(read: CanarySampleReader) {
  return {
    candidate: CANDIDATE,
    profile: PROFILE,
    readPlan: READ_PLAN,
    runId: '00000000-0000-4000-8000-000000000001',
    startedAt: STARTED_AT,
    read,
    waitUntil: async () => {},
    now: () => CAPTURED_AT,
    authorities: [{ sha256: DECISION_SHA256, content: DECISION_RECORD }],
  }
}

describe('canary sampler', () => {
  it('emits a canonical artifact that the Gate F parser accepts', async () => {
    const result = await observeCanaryWindow(input(healthyRead))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.evidence.outcome).toBe('passed')
    const canonical = canonicalCanaryWindowEvidence(result.evidence)
    const parsed = parseCanaryWindowEvidence(canonical)
    expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n')).toBe(true)
    if (!parsed.ok) return
    expect(canonicalCanaryWindowEvidence(parsed.evidence)).toBe(canonical)
  })

  it('reconciles observed and missing samples against the approved duration', async () => {
    const result = await observeCanaryWindow(input(healthyRead))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const [index, observation] of result.evidence.observations.entries()) {
      const signal = PROFILE.signals[index]
      if (!signal) throw new Error('missing signal profile')
      expect(observation.observedSamples + observation.missingSamples).toBe(
        observation.expectedSamples,
      )
      expect(observation.expectedSamples).toBeGreaterThanOrEqual(
        Math.ceil(PROFILE.durationMs / signal.sampleIntervalMs),
      )
    }
  })

  it('counts a thrown read as a missing sample and fails the window', async () => {
    let calls = 0
    const result = await observeCanaryWindow(
      input(async (request) => {
        calls += 1
        if (calls === 3) throw new Error('socket hang up')
        return healthyRead(request)
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const missing = result.evidence.observations.reduce(
      (total, observation) => total + observation.missingSamples,
      0,
    )
    const observed = result.evidence.observations.reduce(
      (total, observation) => total + observation.observedSamples,
      0,
    )
    expect(missing).toBe(1)
    expect(observed).toBe(44)
    expect(result.evidence.continuity.observerReadErrors).toBe(1)
    expect(result.evidence.outcome).toBe('failed')
    expect(result.evidence.failures.join('\n')).toContain('socket hang up')
  })

  it('counts a refused read as a missing sample, never an observed one', async () => {
    const result = await observeCanaryWindow(
      input(async () => ({ ok: false, reason: 'metrics gate returned 404' })),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Every read failed, so there is no observed configuration head. The
    // sampler refuses to emit rather than inventing one.
    expect(result.errors.join('\n')).toContain('configuration head')
  })

  it('records a release-identity drift and fails the window', async () => {
    let calls = 0
    const result = await observeCanaryWindow(
      input(async (request) => {
        calls += 1
        const reading = await healthyRead(request)
        if (calls !== 5 || !reading.ok) return reading
        return {
          ...reading,
          identity: {
            releaseSha: 'c'.repeat(40),
            releaseManifestSha256: MANIFEST_SHA256,
          },
        }
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.evidence.continuity.releaseIdentityMismatches).toBe(1)
    expect(result.evidence.outcome).toBe('failed')
    expect(result.evidence.failures.join('\n')).toContain('RELEASE_SHA')
  })

  it('records a configuration-head drift and fails the window', async () => {
    let calls = 0
    const result = await observeCanaryWindow(
      input(async (request) => {
        calls += 1
        const reading = await healthyRead(request)
        if (calls !== 7 || !reading.ok) return reading
        return { ...reading, configurationHead: '{"capabilityPolicy":"cap-2"}\n' }
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.evidence.continuity.configurationHeadMismatches).toBe(1)
    expect(result.evidence.outcome).toBe('failed')
  })

  it('fails the window when a sampled value breaches its threshold', async () => {
    let calls = 0
    const result = await observeCanaryWindow(
      input(async (request) => {
        calls += 1
        const reading = await healthyRead(request)
        if (calls !== 2 || !reading.ok) return reading
        return { ...reading, value: 3 }
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.evidence.observations.reduce(
        (total, observation) => total + observation.breachCount,
        0,
      ),
    ).toBe(1)
    expect(result.evidence.outcome).toBe('failed')
  })

  it('writes every dependency digest it names as a retained sibling file', async () => {
    const result = await observeCanaryWindow(input(healthyRead))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const written = new Map(
      result.dependencies.map((file) => [file.sha256, file.content] as const),
    )
    for (const digest of canaryWindowDependencyDigests(result.evidence)) {
      expect(written.has(digest), `dependency ${digest} was not written`).toBe(true)
      expect(releaseEvidenceSha256(written.get(digest) ?? '')).toBe(digest)
    }
  })

  it('refuses to run when the supplied decision record does not match the profile', async () => {
    const result = await observeCanaryWindow({
      ...input(healthyRead),
      authorities: [{ sha256: releaseEvidenceSha256('other'), content: 'other' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toContain(DECISION_SHA256)
  })
})
