import { describe, it, expect } from 'vitest'
import { SYNC_SWEEP_LAG_ALERT_MS } from './alert-definitions'
import { evaluateAlerts } from './alert-evaluation'
import { RECONCILIATION_OVERDUE_AFTER_MS } from '#/shared/domain/push-health'

import { AUX, evaluateOne, healthy, withPush } from './alert-definitions.test-fixtures'

describe('sync.failed-nonzero', () => {
  it('fires when any coded sync failure has reached its retry time', () => {
    const s = healthy()
    s.sync = { ...s.sync, failedSyncCount: 2 }

    expect(evaluateOne('sync.failed-nonzero', s)).toMatchObject({
      name: 'sync.failed-nonzero',
      severity: 'P2',
      value: 2,
      threshold: 0,
    })
  })

  it('counts the failing syncs by the code each failed with', () => {
    const s = healthy()
    s.sync = {
      ...s.sync,
      failedSyncCount: 3,
      failedSyncCodes: { provider_failure: 2, authorization_denied: 1 },
    }

    expect(evaluateOne('sync.failed-nonzero', s)!.facts).toEqual({
      count: 3,
      codes: { provider_failure: 2, authorization_denied: 1 },
    })
  })

  it('stays silent when no sync failure is due', () => {
    expect(evaluateOne('sync.failed-nonzero', healthy())).toBeNull()
  })
})

// ── sync freshness: new reviews not arriving ──────────────────────

describe('sync.sweep-lag', () => {
  it('fires when the oldest due property is overdue past four sweeps', () => {
    const s = healthy()
    s.sync = { ...s.sync, dueForIncrementalCount: 5, oldestDueAgeMs: 61 * 60 * 1000 }

    const event = evaluateOne('sync.sweep-lag', s)

    expect(event).toMatchObject({
      name: 'sync.sweep-lag',
      severity: 'P1',
      value: 61 * 60 * 1000,
      threshold: SYNC_SWEEP_LAG_ALERT_MS,
    })
    expect(event!.detail).toContain('push DARK')
  })

  it('reports live push as context without suppressing the alert', () => {
    const s = healthy()
    s.sync = {
      dueForIncrementalCount: 5,
      failedSyncCount: 0,
      failedSyncCodes: {},
      oldestDueAgeMs: SYNC_SWEEP_LAG_ALERT_MS + 1,
      gbpPushEnabled: true,
    }

    const event = evaluateOne('sync.sweep-lag', s)

    expect(event).not.toBeNull()
    expect(event!.detail).toContain('push live')
  })

  it('stays silent at the boundary', () => {
    const s = healthy()
    s.sync = {
      ...s.sync,
      dueForIncrementalCount: 5,
      oldestDueAgeMs: SYNC_SWEEP_LAG_ALERT_MS,
    }

    expect(evaluateOne('sync.sweep-lag', s)).toBeNull()
  })

  it('stays silent when a big due count is fresh — a sweep mid-run is not a fault', () => {
    const s = healthy()
    s.sync = { ...s.sync, dueForIncrementalCount: 500, oldestDueAgeMs: 30_000 }

    expect(evaluateOne('sync.sweep-lag', s)).toBeNull()
  })

  it('stays silent when nothing is due', () => {
    expect(evaluateOne('sync.sweep-lag', healthy())).toBeNull()
  })
})

describe('sync.push-missed', () => {
  it('fires when polling found a new review that no push covered within the hour', () => {
    const event = evaluateOne('sync.push-missed', withPush({ missed24h: 2 }))

    expect(event).toMatchObject({
      name: 'sync.push-missed',
      severity: 'P2',
      runbook: 'runbooks.md §4',
      value: 2,
      threshold: 0,
      windowMs: 24 * 60 * 60 * 1000,
      facts: { count: 2 },
    })
  })

  it('stays silent when no push was missed', () => {
    expect(
      evaluateOne('sync.push-missed', withPush({ late24h: 3, pending: 1 })),
    ).toBeNull()
  })

  it('stays silent while push is not configured', () => {
    expect(evaluateOne('sync.push-missed', withPush({ missed24h: 5 }, false))).toBeNull()
  })

  it('is held, not cleared, while the push signal is degraded', () => {
    const s = withPush({ missed24h: 1 })
    s.degraded = ['health.syncPush']

    const result = evaluateAlerts(s, AUX, new Set(['sync.push-missed']), new Set())

    expect(result.held).toContain('sync.push-missed')
    expect(result.firing).toContain('sync.push-missed')
  })
})

describe('sync.push-silent', () => {
  it('fires when polling is finding new reviews and Pub/Sub accepted no push at all', () => {
    const event = evaluateOne(
      'sync.push-silent',
      withPush({ newByPoll24h: 3, acceptedPushes24h: 0 }),
    )

    expect(event).toMatchObject({
      name: 'sync.push-silent',
      severity: 'P2',
      runbook: 'runbooks.md §4',
      value: 3,
      threshold: 0,
      facts: { count: 3 },
    })
  })

  it('stays silent when any push was accepted', () => {
    expect(
      evaluateOne(
        'sync.push-silent',
        withPush({ newByPoll24h: 3, acceptedPushes24h: 1 }),
      ),
    ).toBeNull()
  })

  it('stays silent when polling found nothing new, so a quiet day is not an outage', () => {
    expect(
      evaluateOne(
        'sync.push-silent',
        withPush({ newByPoll24h: 0, acceptedPushes24h: 0 }),
      ),
    ).toBeNull()
  })

  it('stays silent while push is not configured', () => {
    expect(
      evaluateOne('sync.push-silent', withPush({ newByPoll24h: 3 }, false)),
    ).toBeNull()
  })
})

describe('sync.reconciliation-age', () => {
  const overdue = (count: number, oldestAgeMs: number | null) => {
    const s = healthy()
    s.syncPush = {
      ...s.syncPush,
      reconciliation: {
        ...s.syncPush.reconciliation,
        overdueCount: count,
        oldestAgeMs,
      },
    }
    return s
  }

  it('reports the daily-window threshold used by the health read', () => {
    const limit = 26 * 3_600_000
    const snapshot = overdue(1, limit + 1)
    snapshot.syncPush.reconciliation.overdueAfterMs = limit

    expect(evaluateOne('sync.reconciliation-age', snapshot)).toMatchObject({
      threshold: limit,
      windowMs: limit,
      value: limit + 1,
      facts: { count: 1 },
    })
  })

  it('fires when a syncable Property has gone past eight hours without a completed reconciliation', () => {
    const ageMs = RECONCILIATION_OVERDUE_AFTER_MS + 60_000

    const event = evaluateOne('sync.reconciliation-age', overdue(2, ageMs))

    expect(event).toMatchObject({
      name: 'sync.reconciliation-age',
      severity: 'P2',
      runbook: 'runbooks.md §13',
      value: ageMs,
      threshold: RECONCILIATION_OVERDUE_AFTER_MS,
      windowMs: RECONCILIATION_OVERDUE_AFTER_MS,
      facts: { count: 2 },
    })
  })

  it('stays silent when every Property was reconciled inside the limit', () => {
    expect(evaluateOne('sync.reconciliation-age', overdue(0, null))).toBeNull()
  })

  it('does not depend on push being configured', () => {
    const s = overdue(1, RECONCILIATION_OVERDUE_AFTER_MS + 1)
    expect(s.sync.gbpPushEnabled).toBe(false)

    expect(evaluateOne('sync.reconciliation-age', s)).not.toBeNull()
  })

  it.each(['health.sync', 'health.syncPush'] as const)(
    'is held while %s is degraded',
    (section) => {
      const s = overdue(1, RECONCILIATION_OVERDUE_AFTER_MS + 1)
      s.degraded = [section]

      const result = evaluateAlerts(s, AUX, new Set(), new Set())

      expect(result.held).toContain('sync.reconciliation-age')
      expect(result.firing).not.toContain('sync.reconciliation-age')
    },
  )
})

describe('sync.head-coverage', () => {
  const uncovered = (active: boolean, count: number, oldest: number | null) => {
    const s = healthy()
    s.syncPush = {
      ...s.syncPush,
      headCoverage: { active, uncoveredCount: count, oldestUncoveredAgeMs: oldest },
    }
    return s
  }
  const DAY_MS = 24 * 3_600_000

  it('fires when a window over a day is set and a Property went a day without head cover', () => {
    expect(
      evaluateOne('sync.head-coverage', uncovered(true, 3, DAY_MS + 60_000)),
    ).toMatchObject({
      name: 'sync.head-coverage',
      severity: 'P2',
      runbook: 'runbooks.md §13',
      value: DAY_MS + 60_000,
      threshold: DAY_MS,
      windowMs: DAY_MS,
      facts: { count: 3 },
    })
  })

  it('stays silent when every Property is covered', () => {
    expect(evaluateOne('sync.head-coverage', uncovered(true, 0, null))).toBeNull()
  })

  it('stays silent at a window of a day or less, whatever the cover', () => {
    expect(evaluateOne('sync.head-coverage', uncovered(false, 5, 3 * DAY_MS))).toBeNull()
    expect(evaluateOne('sync.head-coverage', healthy())).toBeNull()
  })

  it.each(['health.sync', 'health.syncPush'] as const)(
    'is held while %s is degraded',
    (section) => {
      const s = uncovered(true, 1, DAY_MS + 1)
      s.degraded = [section]

      const result = evaluateAlerts(s, AUX, new Set(), new Set())

      expect(result.held).toContain('sync.head-coverage')
      expect(result.firing).not.toContain('sync.head-coverage')
    },
  )
})

describe('sync.count-drop-persistent', () => {
  const HOUR_MS = 3_600_000
  const dropped = (count: number, oldest: number | null) => {
    const s = healthy()
    s.syncPush = {
      ...s.syncPush,
      countDrop: { persistentCount: count, oldestAgeMs: oldest },
    }
    return s
  }

  it('fires when a drop in Google’s total has lasted 72 hours', () => {
    expect(
      evaluateOne('sync.count-drop-persistent', dropped(2, 80 * HOUR_MS)),
    ).toMatchObject({
      name: 'sync.count-drop-persistent',
      severity: 'P2',
      runbook: 'runbooks.md §13',
      value: 80 * HOUR_MS,
      threshold: 72 * HOUR_MS,
      windowMs: 72 * HOUR_MS,
      facts: { count: 2 },
    })
  })

  it('stays silent while no drop has lasted 72 hours', () => {
    expect(evaluateOne('sync.count-drop-persistent', dropped(0, null))).toBeNull()
    expect(evaluateOne('sync.count-drop-persistent', healthy())).toBeNull()
  })

  it.each(['health.sync', 'health.syncPush'] as const)(
    'is held while %s is degraded',
    (section) => {
      const s = dropped(1, 73 * HOUR_MS)
      s.degraded = [section]

      const result = evaluateAlerts(s, AUX, new Set(), new Set())

      expect(result.held).toContain('sync.count-drop-persistent')
      expect(result.firing).not.toContain('sync.count-drop-persistent')
    },
  )
})

describe('frozen Google locations', () => {
  it('fire both the failed-sync and the reconciliation-age alerts', () => {
    const s = healthy()
    s.sync = {
      ...s.sync,
      failedSyncCount: 4,
      failedSyncCodes: { provider_rejected: 4 },
    }
    s.syncPush = {
      ...s.syncPush,
      reconciliation: {
        ...s.syncPush.reconciliation,
        overdueCount: 4,
        oldestAgeMs: RECONCILIATION_OVERDUE_AFTER_MS + 60_000,
      },
    }

    const { toDispatch, firing } = evaluateAlerts(s, AUX, new Set(), new Set())

    expect(toDispatch.map(({ name }) => name).sort()).toEqual([
      'sync.failed-nonzero',
      'sync.reconciliation-age',
    ])
    expect([...firing].sort()).toEqual(['sync.failed-nonzero', 'sync.reconciliation-age'])
    expect(toDispatch.find(({ name }) => name === 'sync.failed-nonzero')?.facts).toEqual({
      count: 4,
      codes: { provider_rejected: 4 },
    })
  })
})
