// BQC-8.1 — unit tests for the scale-and-recovery evidence ingester.
//
// The honesty core of the slice: measured rows come ONLY from executed
// scenario result files; anything without a result is "not executed in this
// environment" — never a templated status. The builder throws (fails closed)
// on zero samples, empty monitoring, unknown scenarios, or incomplete
// release identity.

import { describe, it, expect } from 'vitest'
import type { ScenarioRunRecord } from './scenarios/catalogue'
import {
  buildScaleEvidence,
  validateReleaseIdentity,
  EvidenceError,
  type ReleaseIdentity,
} from './scale-evidence'

const IDENTITY: ReleaseIdentity = {
  releaseId: 'local-draft',
  releaseSha: 'abc123def456',
  policyVersions: {
    capabilityPolicy: 'bqc-0.3',
    policyStore: 7,
    routingPolicy: 1,
    sourceContentPolicy: 1,
  },
  datasetHash: 'f'.repeat(64),
  datasetSeed: 'perf-scale-v1',
  datasetShape: { orgs: 2, properties: 20, reviews: 500 },
  owner: 'test-owner',
  generatedAt: '2026-07-31T12:00:00.000Z',
}

function runRecord(overrides: Partial<ScenarioRunRecord> = {}): ScenarioRunRecord {
  return {
    scenario: 'steady',
    startedAt: '2026-07-31T11:00:00.000Z',
    durationMs: 10_000,
    passed: true,
    metrics: {
      targetRatePerSec: 50,
      achievedRatePerSec: 49.6,
      enqueued: 500,
      enqueueErrors: 0,
      enqueueP95: 0.83,
      removedOnCleanup: 500,
    },
    assertions: [
      { check: 'required_samples', passed: true },
      { check: 'enqueue_error_free', passed: true },
      { check: 'rate_achieved', passed: true },
      { check: 'monitoring_captured', passed: true },
    ],
    environment: 'local',
    releaseSha: 'abc123def456',
    versions: {
      capabilityPolicy: 'bqc-0.3',
      policyStore: 7,
      routingPolicy: 1,
      sourceContentPolicy: 1,
    },
    slo: { rate: 20, duration: 1800, noLoss: true },
    samples: { count: 500, errors: 0 },
    monitoring: { points: 10, readErrors: 0 },
    collectors: {
      redisInfo: 'not-collected-in-this-environment',
      dbCpuLocks: 'not-collected-in-this-environment',
    },
    ...overrides,
  }
}

describe('validateReleaseIdentity', () => {
  it('accepts a complete identity', () => {
    expect(() => validateReleaseIdentity(IDENTITY)).not.toThrow()
  })

  it.each([
    ['missing/unknown release sha', { releaseSha: '' }],
    ['unknown release sha', { releaseSha: 'unknown' }],
    ['missing dataset hash', { datasetHash: '' }],
    ['malformed dataset hash', { datasetHash: 'not-a-hash' }],
    [
      'missing capability policy version',
      {
        policyVersions: { ...IDENTITY.policyVersions, capabilityPolicy: '' },
      },
    ],
    ['missing owner', { owner: '' }],
  ])('throws on %s (fail closed)', (_label, patch) => {
    expect(() => validateReleaseIdentity({ ...IDENTITY, ...patch })).toThrow(
      EvidenceError,
    )
  })
})

describe('buildScaleEvidence', () => {
  it('renders measured rows for executed scenarios and not-executed elsewhere', () => {
    const built = buildScaleEvidence({
      results: [runRecord()],
      rawFiles: ['steady.result.json', 'steady.raw.json'],
      identity: IDENTITY,
    })
    const md = built.markdown

    // Identity header.
    expect(md).toContain('**Release id:** local-draft')
    expect(md).toContain('**Release sha:** abc123def456')
    expect(md).toContain('capability=bqc-0.3')
    expect(md).toContain('routing=1')
    expect(md).toContain(`**Dataset hash:** ${'f'.repeat(64)}`)
    expect(md).toContain(
      '**Dataset:** seed `perf-scale-v1` — 2 orgs / 20 properties / 500 reviews',
    )

    // Measured row with real metrics.
    expect(md).toMatch(/\| `steady` \| PASS \|/)
    expect(md).toContain('49.6/s')
    expect(built.executed).toEqual([{ key: 'steady', passed: true }])
    expect(built.failures).toEqual([])

    // Everything else: honest not-executed.
    expect(md.match(/not executed in this environment/g)!.length).toBeGreaterThan(10)
    expect(built.notExecuted).toContain('burst')
    expect(built.notExecuted).toContain('dashboardMix')
    expect(built.faultsNotExecuted).toHaveLength(12)

    // The banned template phrasing is gone for good.
    expect(md).not.toContain('pending staging')
    expect(md).not.toContain('pending')

    // Raw data listing.
    expect(md).toContain('raw/steady.result.json')
    expect(md).toContain('raw/steady.raw.json')

    // RPO/RTO rows carry targets but no invented results.
    expect(md).toContain('≤ 900s')
    expect(md).toContain('≤ 14400s')
  })

  it('reports SLO violations as failures (a failing summary, not a silent pass)', () => {
    const failed = runRecord({
      scenario: 'drain',
      passed: false,
      metrics: { backlogSize: 30, remainingWaiting: 30 },
      assertions: [
        { check: 'required_samples', passed: true },
        {
          check: 'drained_within_timeout',
          passed: false,
          detail: '30 jobs still waiting',
        },
      ],
      samples: { count: 30, errors: 0 },
      monitoring: { points: 3, readErrors: 0 },
    })
    const built = buildScaleEvidence({
      results: [runRecord(), failed],
      rawFiles: [],
      identity: IDENTITY,
    })
    expect(built.failures).toEqual(['drain'])
    expect(built.markdown).toMatch(/\| `drain` \| FAIL \|/)
    expect(built.markdown).toMatch(/`steady` \| PASS/)
    // The failing assertion detail is carried into the evidence.
    expect(built.markdown).toContain('30 jobs still waiting')
  })

  it('throws on an unknown scenario result (no silent extra rows)', () => {
    expect(() =>
      buildScaleEvidence({
        results: [runRecord({ scenario: 'notInTheCatalogue' })],
        rawFiles: [],
        identity: IDENTITY,
      }),
    ).toThrow(EvidenceError)
  })

  it('throws on zero-sample results (no evidence without measurement)', () => {
    expect(() =>
      buildScaleEvidence({
        results: [runRecord({ samples: { count: 0, errors: 0 } })],
        rawFiles: [],
        identity: IDENTITY,
      }),
    ).toThrow(/samples/)
  })

  it('throws on empty monitoring series (no evidence without monitoring)', () => {
    expect(() =>
      buildScaleEvidence({
        results: [runRecord({ monitoring: { points: 0, readErrors: 0 } })],
        rawFiles: [],
        identity: IDENTITY,
      }),
    ).toThrow(/monitoring/)
  })

  it('throws when results mix release shas or policy versions (one candidate per pack)', () => {
    const other = runRecord({
      scenario: 'burst',
      releaseSha: 'different-sha',
      samples: { count: 10, errors: 0 },
      monitoring: { points: 2, readErrors: 0 },
    })
    expect(() =>
      buildScaleEvidence({
        results: [runRecord(), other],
        rawFiles: [],
        identity: IDENTITY,
      }),
    ).toThrow(/mixed|candidate|release/i)
  })

  it('requires at least one executed result (identity is unprovable otherwise)', () => {
    expect(() =>
      buildScaleEvidence({ results: [], rawFiles: [], identity: IDENTITY }),
    ).toThrow(EvidenceError)
  })
})
