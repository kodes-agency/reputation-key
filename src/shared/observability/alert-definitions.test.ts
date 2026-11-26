// Alert-definition unit tests for the freshness/delivery signals: the pure
// `evaluate` of each alert added for the notification pipeline, plus the one
// contract the registry could previously violate silently — a runbook anchor
// that does not resolve to a real section.
//
// An alert whose runbook anchor is dead is worse than no alert: it pages an
// operator and then sends them nowhere. The whole registry is checked here,
// not just the new entries.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ALERT_DEFINITIONS,
  QUARANTINE_NONEMPTY_ALERT_MS,
  type AlertAuxReads,
} from './alert-definitions'
import { evaluateAlerts } from './alert-evaluation'
import { SNAPSHOT_SECTIONS } from '#/shared/observability/snapshot-sections'

import { AUX, evaluateOne, healthy } from './alert-definitions.test-fixtures'

const RUNBOOKS_PATH = 'docs/operations/runbooks.md'

// ── runbook anchors ────────────────────────────────────────────────

describe('runbook anchors resolve', () => {
  it('every alert points at a section that exists in runbooks.md', () => {
    const doc = readFileSync(RUNBOOKS_PATH, 'utf-8')
    const sections = new Set(
      [...doc.matchAll(/^## (\d+)\. /gm)].map((m) => `runbooks.md §${m[1]}`),
    )
    expect(sections.size, 'runbooks.md must declare numbered sections').toBeGreaterThan(0)
    const dangling = ALERT_DEFINITIONS.filter((d) => !sections.has(d.runbook)).map(
      (d) => `${d.name} → ${d.runbook}`,
    )
    expect(
      dangling,
      'these alerts link to a runbook section that does not exist:\n' +
        dangling.join('\n'),
    ).toEqual([])
  })
})

// ── degraded snapshot sections: the alerts that cannot see ─────────

describe('observability.snapshot-degraded', () => {
  it('fires when a degraded section blinds alerts, naming the section and each alert', () => {
    const s = healthy()
    s.degraded = ['health.outbox']

    const event = evaluateOne('observability.snapshot-degraded', s)

    expect(event).toMatchObject({
      name: 'observability.snapshot-degraded',
      severity: 'P1',
      value: 1,
      threshold: 0,
      runbook: 'runbooks.md §23',
    })
    expect(event!.detail).toContain('health.outbox')
    expect(event!.detail).toContain('queue.oldest-age')
  })

  it('pages only once the blindness holds for a second consecutive evaluation', () => {
    const s = healthy()
    s.degraded = ['health.outbox']

    const first = evaluateAlerts(s, AUX, new Set(), new Set())
    expect(first.pending).toEqual(['observability.snapshot-degraded'])
    expect(first.firing).toEqual([])
    expect(first.toDispatch).toEqual([])

    const second = evaluateAlerts(s, AUX, new Set(), new Set(first.pending))
    expect(second.toDispatch.map((event) => event.name)).toEqual([
      'observability.snapshot-degraded',
    ])
    expect(second.firing).toEqual(['observability.snapshot-degraded'])
    expect(second.pending).toEqual([])
  })

  it('never pages a signal that degrades only on alternate evaluations', () => {
    const blind = healthy()
    blind.degraded = ['health.notificationDeliveryLag']

    const degradedRun = evaluateAlerts(blind, AUX, new Set(), new Set())
    const readableRun = evaluateAlerts(
      healthy(),
      AUX,
      new Set(),
      new Set(degradedRun.pending),
    )
    const degradedAgain = evaluateAlerts(
      blind,
      AUX,
      new Set(),
      new Set(readableRun.pending),
    )

    expect(readableRun.pending).toEqual([])
    expect(degradedAgain.pending).toEqual(['observability.snapshot-degraded'])
    expect([
      ...degradedRun.toDispatch,
      ...readableRun.toDispatch,
      ...degradedAgain.toDispatch,
    ]).toEqual([])
  })

  it('stays quiet when nothing is degraded or only fail-visible sections are', () => {
    expect(evaluateOne('observability.snapshot-degraded', healthy())).toBeNull()

    // Each of these either feeds no alert or fires its own alert on the
    // fallback, so none of them leaves an alert blind.
    const s = healthy()
    s.degraded = ['queues', 'workers.heartbeat', 'jobs', 'guest.observationLoss']
    expect(evaluateOne('observability.snapshot-degraded', s)).toBeNull()
  })
})

// Holding depends on each definition declaring the health signals it reads:
// a new alert over a health field that forgets `blindedBy` would clear on the
// zero fallback and re-page on recovery, silently. Every implemented alert
// must either be held when every health signal is degraded, or be named here
// with the input it reads instead.
const READS_NO_HEALTH_SIGNAL: Readonly<Record<string, string>> = {
  'worker.heartbeat.stale': 'workers.heartbeat — fires on its own stale fallback',
  'worker.job-runtime-unready': 'jobs — fires when the report is unavailable',
  'guest.observation-loss':
    'guestObservationLoss — fires when the monitor is unavailable',
  'observability.snapshot-degraded': 'degraded — the page for the blindness itself',
  'ai.review-analysis-stalled': 'aux reads — fires when the monitor is unavailable',
  'ai.review-analysis-empty-enrollment': 'aux reads',
  'retention.failure': 'aux reads — fires when the monitor is unavailable',
  'db.pool-exhaustion': 'runtime — the in-process pool gauge',
}

describe('blindedBy registry contract', () => {
  it('holds every alert over a health signal when every health signal is degraded', () => {
    const s = healthy()
    s.degraded = SNAPSHOT_SECTIONS.filter((section) => section.startsWith('health.'))

    const { held } = evaluateAlerts(s, AUX, new Set(), new Set())

    const unheld = ALERT_DEFINITIONS.filter(
      (def) => def.evaluate !== null && !held.includes(def.name),
    ).map((def) => def.name)
    expect(unheld.sort()).toEqual(Object.keys(READS_NO_HEALTH_SIGNAL).sort())
  })
})

describe('evaluateAlerts on a degraded snapshot', () => {
  it('holds an alert already firing when its section degrades instead of clearing it', () => {
    const s = healthy()
    s.degraded = ['health.quarantine']
    s.quarantine = null

    const result = evaluateAlerts(
      s,
      AUX,
      new Set(['queue.quarantine-nonempty']),
      new Set(['observability.snapshot-degraded']),
    )

    expect(result.firing).toContain('queue.quarantine-nonempty')
    expect(result.held).toEqual(['queue.quarantine-growth', 'queue.quarantine-nonempty'])
    expect(result.toDispatch.map((event) => event.name)).toEqual([
      'observability.snapshot-degraded',
    ])
  })

  it('opens no new edge on a degraded section, whatever its fallback reads', () => {
    const s = healthy()
    s.degraded = ['health.quarantine']
    s.quarantine = { count: 1, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }

    const result = evaluateAlerts(s, AUX, new Set(), new Set())

    expect(result.firing).not.toContain('queue.quarantine-nonempty')
    expect(result.toDispatch.map((event) => event.name)).not.toContain(
      'queue.quarantine-nonempty',
    )
  })
})

describe('beta-feedback.triage-backlog is off for the closed beta', () => {
  const NAME = 'beta-feedback.triage-backlog'
  const HUNDRED_DAYS_MS = 100 * 24 * 60 * 60 * 1000

  it('is not a defined alert', () => {
    expect(ALERT_DEFINITIONS.map((definition) => definition.name)).not.toContain(NAME)
  })

  it.each([
    [
      'a delivered report left unresolved for months',
      {
        monitorAvailable: true,
        deliveredUnresolvedCount: 6,
        oldestDeliveredUnresolvedAgeMs: HUNDRED_DAYS_MS,
      },
    ],
    [
      'an unavailable triage monitor',
      {
        monitorAvailable: false,
        deliveredUnresolvedCount: 0,
        oldestDeliveredUnresolvedAgeMs: null,
      },
    ],
    [
      'an incomplete reading',
      {
        monitorAvailable: true,
        deliveredUnresolvedCount: 2,
        oldestDeliveredUnresolvedAgeMs: null,
      },
    ],
  ])('dispatches nothing for %s', (_label, betaFeedbackTriage) => {
    const evaluation = evaluateAlerts(
      healthy(),
      { ...AUX, betaFeedbackTriage },
      new Set(),
      new Set(),
    )

    expect(evaluation.toDispatch).toEqual([])
    expect(evaluation.firing).toEqual([])
    expect(evaluation.pending).toEqual([])
  })

  it('leaves a firing mark left by an earlier release to expire, never re-paging it', () => {
    const evaluation = evaluateAlerts(healthy(), AUX, new Set([NAME]), new Set([NAME]))

    expect(evaluation.toDispatch).toEqual([])
    expect(evaluation.firing).not.toContain(NAME)
  })
})

describe('an auxiliary read that did not answer', () => {
  const UNAVAILABLE_ANALYSIS: AlertAuxReads = {
    ...AUX,
    reviewAnalysis: { ...AUX.reviewAnalysis, monitorAvailable: false },
  }

  it('keeps an empty-enrollment alert that is already firing, without paging again', () => {
    const result = evaluateAlerts(
      healthy(),
      UNAVAILABLE_ANALYSIS,
      new Set(['ai.review-analysis-empty-enrollment']),
      new Set(),
    )

    expect(result.firing).toContain('ai.review-analysis-empty-enrollment')
    expect(result.held).toContain('ai.review-analysis-empty-enrollment')
    expect(result.toDispatch.map(({ name }) => name)).not.toContain(
      'ai.review-analysis-empty-enrollment',
    )
  })

  it('does not open an empty-enrollment alert from the fallback', () => {
    const result = evaluateAlerts(healthy(), UNAVAILABLE_ANALYSIS, new Set(), new Set())

    expect(result.firing).not.toContain('ai.review-analysis-empty-enrollment')
  })

  it('keeps the coverage alert that is already firing, without paging again', () => {
    const result = evaluateAlerts(
      healthy(),
      UNAVAILABLE_ANALYSIS,
      new Set(['ai.review-analysis-stalled']),
      new Set(),
    )

    expect(result.firing).toContain('ai.review-analysis-stalled')
    expect(result.toDispatch.map(({ name }) => name)).not.toContain(
      'ai.review-analysis-stalled',
    )
  })

  it('keeps a firing retention alert when the retention read fails', () => {
    const result = evaluateAlerts(
      healthy(),
      { ...AUX, retention: { monitorAvailable: false, failedSubjects: [] } },
      new Set(['retention.failure']),
      new Set(),
    )

    expect(result.firing).toContain('retention.failure')
    expect(result.toDispatch).toEqual([])
  })
})
