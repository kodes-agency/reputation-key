// BQC-8.1 — pins the scenario/fault catalogue as the single source of truth.
//
// Values are the ADR 0038 / PRE17C §9.2-9.3 numbers: a drift here must be a
// deliberate, reviewed change — this test is the tripwire. Also pins the
// honesty rule: nothing in the catalogue may contain templated status text.

import { describe, it, expect } from 'vitest'
import {
  SLOS,
  SCENARIOS,
  FAULTS,
  createResult,
  serializeResult,
  parseResult,
  type ScenarioRunRecord,
} from './catalogue'

describe('SLO inventory', () => {
  it('pins the ADR 0038 / PRE17C numbers', () => {
    expect(SLOS).toEqual({
      steadyReviewRate: 20,
      burstReviewRate: 100,
      burstDuration: 60,
      drainTimeout: 600,
      rpoTarget: 900,
      rtoTarget: 14_400,
      dashboardP95: 500,
      dashboardColdP95: 2000,
      maxQueueDepth: 10_000,
      outboxLagP95: 5000,
      fleetProperties: 5000,
      fleetWindow: 4,
      // BQC-8.2: capacity-execution thresholds (ADR 0038 + §8.2).
      replyPublishTerminalP95: 10_000,
      replyBurstSize: 25,
      reconnectOutage: 30,
      hotPropertyBurstRate: 100,
      backgroundRateFloor: 0.8,
    })
  })
})

describe('scenario inventory', () => {
  it('contains the §9.2 scenarios (incl. first-class drain) with SLO definitions', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(
      [
        'burst',
        'dashboardCold',
        'dashboardMix',
        'drain',
        'fleetDispatch',
        'reconciliation',
        'reconnect',
        'replyBurst',
        'retention',
        'singlePropertyBurst',
        'steady',
      ].sort(),
    )
    for (const [key, s] of Object.entries(SCENARIOS)) {
      expect(s.name.length, key).toBeGreaterThan(0)
      expect(s.description.length, key).toBeGreaterThan(0)
      expect(Object.keys(s.slo).length, key).toBeGreaterThan(0)
    }
  })

  it('contains the 12 §9.3 faults with invariant + recovery', () => {
    expect(Object.keys(FAULTS)).toHaveLength(12)
    for (const [key, f] of Object.entries(FAULTS)) {
      expect(f.trigger.length, key).toBeGreaterThan(0)
      expect(f.invariant.length, key).toBeGreaterThan(0)
      expect(f.expectedRecovery.length, key).toBeGreaterThan(0)
    }
  })

  it('contains no templated execution status (honesty rule)', () => {
    const json = JSON.stringify({ SLOS, SCENARIOS, FAULTS })
    expect(json).not.toContain('pending staging')
    expect(json).not.toContain('pending')
  })
})

describe('run record store', () => {
  const record: ScenarioRunRecord = {
    scenario: 'steady',
    startedAt: '2026-07-31T00:00:00.000Z',
    durationMs: 10_000,
    passed: true,
    metrics: { achievedRatePerSec: 20 },
    assertions: [{ check: 'required_samples', passed: true }],
    environment: 'local',
    releaseSha: 'abc123',
    versions: {
      capabilityPolicy: 'cap-1',
      policyStore: 7,
      routingPolicy: 1,
      sourceContentPolicy: 3,
    },
    slo: { rate: 20, duration: 1800, noLoss: true },
    samples: { count: 200, errors: 0 },
    monitoring: { points: 10, readErrors: 0 },
    collectors: {
      redisInfo: 'redis-cli',
      dbCpuLocks: 'not-collected-in-this-environment',
    },
  }

  it('serializes and parses back the identical record', () => {
    expect(parseResult(serializeResult(record))).toEqual(record)
  })

  it('rejects malformed or version-drifted records (fail closed)', () => {
    expect(() => parseResult('nope')).toThrow(SyntaxError)
    expect(() => parseResult('{"version":99}')).toThrow(/version/)
    expect(() => parseResult(JSON.stringify({ version: 2, scenario: 'steady' }))).toThrow(
      /shape/,
    )
    // Zero-sample records PARSE (they are well-formed) — the evidence
    // ingester, not the parser, owns the fail-closed samples rule.
  })
})

describe('createResult', () => {
  it('derives passed from the assertions and timestamps from the clock', () => {
    const clock = () => new Date('2026-07-31T12:00:00.000Z')
    const ok = createResult('steady', 1000, {}, [{ check: 'a', passed: true }], clock)
    expect(ok.passed).toBe(true)
    expect(ok.startedAt).toBe('2026-07-31T12:00:00.000Z')
    const bad = createResult(
      'steady',
      1000,
      {},
      [
        { check: 'a', passed: true },
        { check: 'b', passed: false },
      ],
      clock,
    )
    expect(bad.passed).toBe(false)
  })
})
