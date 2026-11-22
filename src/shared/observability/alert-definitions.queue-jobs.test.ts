import { describe, it, expect } from 'vitest'
import {
  REVIEW_ANALYSIS_STALLED_ALERT_MS,
  QUARANTINE_NONEMPTY_ALERT_MS,
  QUARANTINE_REDRIVE_SLA_ALERT_MS,
} from './alert-definitions'

import {
  AUX,
  evaluateOne,
  healthy,
  jobRow,
  jobsReport,
} from './alert-definitions.test-fixtures'

describe('ai.review-analysis-stalled', () => {
  it('fires when incomplete coverage has made no settlement progress past the threshold', () => {
    const event = evaluateOne('ai.review-analysis-stalled', healthy(), {
      ...AUX,
      reviewAnalysis: {
        ...AUX.reviewAnalysis,
        incompletePropertyCount: 1,
        pendingSettlementCount: 4,
        oldestNoProgressAgeMs: REVIEW_ANALYSIS_STALLED_ALERT_MS + 1,
      },
    })

    expect(event).toMatchObject({
      name: 'ai.review-analysis-stalled',
      severity: 'P2',
      value: REVIEW_ANALYSIS_STALLED_ALERT_MS + 1,
      threshold: REVIEW_ANALYSIS_STALLED_ALERT_MS,
      windowMs: REVIEW_ANALYSIS_STALLED_ALERT_MS,
    })
    expect(event!.detail).toContain('1 AI-enabled property')
    expect(event!.detail).toContain('4 pending settlement')
  })

  it('stays silent while incomplete coverage is still advancing', () => {
    expect(
      evaluateOne('ai.review-analysis-stalled', healthy(), {
        ...AUX,
        reviewAnalysis: {
          ...AUX.reviewAnalysis,
          incompletePropertyCount: 1,
          pendingSettlementCount: 999,
          oldestNoProgressAgeMs: REVIEW_ANALYSIS_STALLED_ALERT_MS,
        },
      }),
    ).toBeNull()
  })

  it('stays silent when no property has AI enablement', () => {
    expect(evaluateOne('ai.review-analysis-stalled', healthy())).toBeNull()
  })
})

describe('ai.review-analysis-empty-enrollment', () => {
  it('fires when an actionable zero-snapshot enrollment missed eligible reviews', () => {
    const event = evaluateOne('ai.review-analysis-empty-enrollment', healthy(), {
      ...AUX,
      reviewAnalysis: {
        ...AUX.reviewAnalysis,
        zeroSnapshotEnrollmentCount: 1,
        eligibleReviewCountMissed: 18,
      },
    })

    expect(event).toMatchObject({
      name: 'ai.review-analysis-empty-enrollment',
      severity: 'P2',
      value: 1,
      threshold: 0,
      windowMs: 5 * 60 * 1000,
    })
    expect(event!.detail).toContain('18 eligible review')
  })

  it('stays silent without a mismatched actionable enrollment', () => {
    expect(evaluateOne('ai.review-analysis-empty-enrollment', healthy())).toBeNull()
  })
})

describe('worker.job-runtime-unready', () => {
  it('fires when any governed family misses registration, freshness, or repair', () => {
    const s = healthy()
    s.jobs = jobsReport({
      ready: false,
      total: 1,
      active: 1,
      failing: 1,
      schedulerMissing: 1,
      scheduleDenied: 1,
      missedObjectives: 1,
      gateDenials: 3,
      terminalFailures: 4,
    })

    const event = evaluateOne('worker.job-runtime-unready', s)

    expect(event).toMatchObject({
      name: 'worker.job-runtime-unready',
      severity: 'P1',
      value: 1,
      threshold: 0,
    })
    expect(event!.detail).toContain('schedulerMissing=1')
    // Every unready reason has a counter; none can hide behind a detail of zeros.
    expect(event!.detail).toContain('invalidObservations=0')
    expect(event!.detail).toContain('missedObjectives=1')
    expect(event!.detail).toContain('scheduleDenied=1')
  })

  it('names the unready job families and why, never the ready ones', () => {
    const s = healthy()
    s.jobs = jobsReport({
      ready: false,
      total: 3,
      active: 3,
      failing: 2,
      repairRequired: 2,
      deadLetters: 1,
      rows: [
        jobRow('sync-property-reviews', ['repair_required', 'dead_letter_present'], 1),
        jobRow('discover-new-reviews'),
        jobRow('purge-expired-reviews', ['repair_required']),
      ],
    })

    expect(evaluateOne('worker.job-runtime-unready', s)!.facts).toEqual({
      jobs: ['sync-property-reviews', 'purge-expired-reviews'],
      reasons: ['repair_required', 'dead_letter_present'],
      count: 2,
    })
  })

  it('says the report was unavailable when the authority could not be read', () => {
    const s = healthy()
    delete s.jobs
    s.degraded = ['jobs']

    expect(evaluateOne('worker.job-runtime-unready', s)!.facts).toEqual({
      reasons: ['report_unavailable'],
    })
  })

  it('stays silent when ready and fails visible when the authority is unavailable', () => {
    const readyJobs = jobsReport({})
    const ready = healthy()
    ready.jobs = readyJobs
    expect(evaluateOne('worker.job-runtime-unready', ready)).toBeNull()
    // Retained failures are history: an unanswered one is already repair_required.
    const withHistory = healthy()
    withHistory.jobs = { ...readyJobs, terminalFailures: 9 }
    expect(evaluateOne('worker.job-runtime-unready', withHistory)).toBeNull()

    const unavailable = healthy()
    delete unavailable.jobs
    unavailable.degraded = ['jobs']
    const unavailableEvent = evaluateOne('worker.job-runtime-unready', unavailable)
    expect(unavailableEvent).toMatchObject({ value: 1, threshold: 0 })
    expect(unavailableEvent!.detail).toContain('unavailable')
  })
})

describe('queue.quarantine-nonempty', () => {
  it('reports durable delivery quarantine after worker death even with an empty Redis quarantine', () => {
    const s = healthy()
    s.quarantine = {
      count: 0,
      oldestAgeMs: null,
      workItems: { count: 1, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 },
    }
    expect(evaluateOne('queue.quarantine-nonempty', s)).toMatchObject({
      severity: 'P1',
      facts: { count: 1, jobs: ['outbox-delivery'] },
    })
    expect(evaluateOne('queue.quarantine-growth', s)).toBeNull()
    s.quarantine = {
      ...s.quarantine,
      workItems: { count: 1, oldestAgeMs: QUARANTINE_REDRIVE_SLA_ALERT_MS + 1 },
    }
    expect(evaluateOne('queue.quarantine-growth', s)).toMatchObject({
      severity: 'P2',
      facts: { count: 1, jobs: ['outbox-delivery'] },
    })
  })

  it('fires once a quarantined job has sat past the sustainment window', () => {
    const s = healthy()
    s.quarantine = { count: 2, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }

    const event = evaluateOne('queue.quarantine-nonempty', s)

    expect(event).toMatchObject({
      name: 'queue.quarantine-nonempty',
      severity: 'P1',
      value: QUARANTINE_NONEMPTY_ALERT_MS + 1,
      threshold: QUARANTINE_NONEMPTY_ALERT_MS,
    })
    expect(event!.detail).toContain('quarantine')
  })

  it('counts the quarantined jobs and names the families holding dead letters', () => {
    const s = healthy()
    s.quarantine = { count: 3, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }
    s.jobs = jobsReport({
      ready: false,
      total: 2,
      active: 2,
      failing: 1,
      deadLetters: 3,
      rows: [
        jobRow('sync-property-reviews', ['dead_letter_present'], 3),
        jobRow('discover-new-reviews'),
      ],
    })

    expect(evaluateOne('queue.quarantine-nonempty', s)!.facts).toEqual({
      count: 3,
      jobs: ['sync-property-reviews'],
    })
    expect(
      evaluateOne('queue.quarantine-growth', {
        ...s,
        quarantine: { count: 3, oldestAgeMs: QUARANTINE_REDRIVE_SLA_ALERT_MS + 1 },
      })!.facts,
    ).toEqual({ count: 3, jobs: ['sync-property-reviews'] })
  })

  it('still counts the quarantined jobs when the job report is unavailable', () => {
    const s = healthy()
    s.quarantine = { count: 2, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }

    expect(evaluateOne('queue.quarantine-nonempty', s)!.facts).toEqual({ count: 2 })
  })

  it('stays silent at the boundary — a job an operator is redriving now must not page', () => {
    const s = healthy()
    s.quarantine = { count: 1, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS }

    expect(evaluateOne('queue.quarantine-nonempty', s)).toBeNull()
  })

  it('stays silent on an empty quarantine and when the queue handle is absent', () => {
    expect(evaluateOne('queue.quarantine-nonempty', healthy())).toBeNull()

    const noHandle = healthy()
    noHandle.quarantine = null
    expect(evaluateOne('queue.quarantine-nonempty', noHandle)).toBeNull()
  })

  it('is separable from the 24h redrive-SLA alert', () => {
    const s = healthy()
    s.quarantine = { count: 1, oldestAgeMs: QUARANTINE_NONEMPTY_ALERT_MS + 1 }

    // Fresh loss pages on §14 only; §4 is the same condition left for a day.
    expect(evaluateOne('queue.quarantine-nonempty', s)).not.toBeNull()
    expect(evaluateOne('queue.quarantine-growth', s)).toBeNull()

    s.quarantine = { count: 1, oldestAgeMs: QUARANTINE_REDRIVE_SLA_ALERT_MS + 1 }
    expect(evaluateOne('queue.quarantine-growth', s)).not.toBeNull()
  })
})

describe('guest.observation-loss', () => {
  it('fires on a true suppressed scan or review-link loss', () => {
    const s = healthy()
    s.guestObservationLoss = {
      ...s.guestObservationLoss!,
      scanLossCount: 2,
      reviewLinkLossCount: 1,
      totalLossCount: 3,
    }

    const event = evaluateOne('guest.observation-loss', s)
    expect(event).toMatchObject({
      name: 'guest.observation-loss',
      severity: 'P1',
      value: 3,
      threshold: 0,
      windowMs: 24 * 60 * 60 * 1000,
    })
    expect(event!.detail).toContain('scans=2')
    expect(event!.detail).toContain('reviewLinks=1')
    expect(event!.detail).toContain('ratings=not_applicable_durable')
  })

  it('fails visible when the monitor is unavailable and stays quiet for durable ratings', () => {
    const unavailable = healthy()
    unavailable.guestObservationLoss = {
      ...unavailable.guestObservationLoss!,
      monitorAvailable: false,
    }
    const event = evaluateOne('guest.observation-loss', unavailable)
    expect(event).toMatchObject({ value: 1, threshold: 0 })
    expect(event!.detail).toContain('unavailable')

    expect(evaluateOne('guest.observation-loss', healthy())).toBeNull()
    expect(healthy().guestObservationLoss).toMatchObject({
      ratingLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    })
  })
})

describe('retention.failure', () => {
  it('fires naming every subject whose latest run failed', () => {
    const event = evaluateOne('retention.failure', healthy(), {
      ...AUX,
      retention: {
        monitorAvailable: true,
        failedSubjects: ['reviews.purge', 'guest.contact_requests'],
      },
    })

    expect(event).toMatchObject({
      name: 'retention.failure',
      severity: 'P1',
      value: 2,
      threshold: 0,
      runbook: 'runbooks.md §8',
    })
    expect(event!.detail).toBe(
      'latest retention run failed for: reviews.purge, guest.contact_requests',
    )
  })

  it('stays quiet when every latest run was read and none failed', () => {
    expect(evaluateOne('retention.failure', healthy())).toBeNull()
  })

  // A failed read of retention_runs used to hand the alert an empty list, which
  // it could not tell from "every latest run succeeded".
  it('fails visible when the run evidence could not be read', () => {
    const event = evaluateOne('retention.failure', healthy(), {
      ...AUX,
      retention: { monitorAvailable: false, failedSubjects: [] },
    })

    expect(event).toMatchObject({ name: 'retention.failure', severity: 'P1', value: -1 })
    expect(event!.detail).toBe(
      'retention run monitor unavailable — whether the latest sweeps succeeded is unknown',
    )
  })
})

// The 72-hour triage-backlog alert is off for the closed beta (owner decision
// 2026-10-19; ADR 0059 note). The ledger it watched and the aux read behind it
// stay; only the page goes. Bringing it back for general availability is a
