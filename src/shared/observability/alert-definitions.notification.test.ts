import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
  NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
  NOTIFICATION_EMAIL_STALLED_ALERT_MS,
  NOTIFICATION_EMAIL_BOUNCE_MIN_COUNT,
  NOTIFICATION_EMAIL_PERMANENT_FAILURE_MIN_COUNT,
  NOTIFICATION_EMAIL_BOUNCE_RATE_ALERT_PERCENT,
  NOTIFICATION_EMAIL_OUTCOME_WINDOW_MS,
  NOTIFICATION_EMAIL_PERMANENT_FAILURE_SHARE_ALERT_PERCENT,
  NOTIFICATION_EMAIL_UNRESOLVED_ALERT_COUNT,
  NOTIFICATION_EMAIL_UNRESOLVED_LOOKBACK_MS,
} from './alert-definitions'
import { alertFactTags } from './alert-facts'

import {
  evaluateOne,
  healthy,
  type MutableSnapshot,
} from './alert-definitions.test-fixtures'

describe('notification.in-app-delivery-lag', () => {
  it('fires from durable source age when delivery exceeds 60 seconds', () => {
    const source = healthy()
    source.notifications.deliveryLag = {
      ...source.notifications.deliveryLag,
      sourceReceiptPending: 2,
      oldestSourceRecordedAt: '2026-08-20T23:58:59.999Z',
      oldestSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
      sourceSaturated: true,
    }
    const sourceEvent = evaluateOne('notification.in-app-delivery-lag', source)
    expect(sourceEvent).toMatchObject({
      severity: 'P1',
      value: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
      threshold: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    })
    expect(sourceEvent!.detail).toContain('source receipts=2+')
  })

  it('names what is pending by route event type, and carries nothing else', () => {
    const s = healthy()
    s.notifications.deliveryLag = {
      ...s.notifications.deliveryLag,
      sourceReceiptPending: 5,
      sourceReceiptPendingByEventType: {
        'inbox.handling_cycle.closed': 3,
        'inbox.inbox_item.created': 2,
      },
      oldestSourceRecordedAt: '2026-08-20T23:58:59.999Z',
      oldestSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
    }

    const event = evaluateOne('notification.in-app-delivery-lag', s)

    expect(event!.facts).toEqual({
      count: 5,
      codes: { 'inbox.handling_cycle.closed': 3, 'inbox.inbox_item.created': 2 },
    })
    expect(alertFactTags(event!.facts)).toEqual({
      alert_count: '5',
      alert_codes: 'inbox.handling_cycle.closed:3,inbox.inbox_item.created:2',
    })
  })

  it('says when the breakdown comes from a capped scan', () => {
    const s = healthy()
    s.notifications.deliveryLag = {
      ...s.notifications.deliveryLag,
      sourceReceiptPending: 1000,
      sourceReceiptPendingByEventType: { 'inbox.inbox_item.created': 1000 },
      sourceSaturated: true,
      oldestSourceRecordedAt: '2026-08-20T23:58:59.999Z',
      oldestSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
    }

    const event = evaluateOne('notification.in-app-delivery-lag', s)

    expect(event!.facts).toEqual({
      count: 1000,
      codes: { 'inbox.inbox_item.created': 1000 },
      reasons: ['source_scan_saturated'],
    })
  })

  it('names the breakdown when the durable-source clock is missing too', () => {
    const s = healthy()
    s.notifications.deliveryLag = {
      ...s.notifications.deliveryLag,
      sourceReceiptPending: 2,
      sourceReceiptPendingByEventType: { 'inbox.inbox_item.created': 2 },
    }

    const event = evaluateOne('notification.in-app-delivery-lag', s)

    expect(event!.facts).toEqual({
      count: 2,
      codes: { 'inbox.inbox_item.created': 2 },
    })
  })

  it('stays silent at 60 seconds and when no delivery is pending', () => {
    const boundary = healthy()
    boundary.notifications.deliveryLag = {
      ...boundary.notifications.deliveryLag,
      sourceReceiptPending: 1,
      oldestSourceRecordedAt: '2026-08-20T23:59:00.000Z',
      oldestSourceAgeMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    }
    expect(evaluateOne('notification.in-app-delivery-lag', boundary)).toBeNull()
    expect(evaluateOne('notification.in-app-delivery-lag', healthy())).toBeNull()
  })
})

describe('notification.immediate-email-acceptance-lag', () => {
  it('fires when source-clock p99 or the oldest awaiting attempt exceeds five minutes', () => {
    const accepted = healthy()
    accepted.notifications.deliveryLag.immediateEmailAcceptance = {
      ...accepted.notifications.deliveryLag.immediateEmailAcceptance,
      acceptedLatencyP99Ms: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
      acceptedSampleCount: 100,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', accepted),
    ).toMatchObject({
      severity: 'P2',
      value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
      threshold: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    })

    const awaiting = healthy()
    awaiting.notifications.emailDeliveryEnabled = true
    awaiting.notifications.deliveryLag.immediateEmailAcceptance = {
      ...awaiting.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 2,
      oldestAwaitingSourceRecordedAt: '2026-08-20T23:54:59.999Z',
      oldestAwaitingSourceAgeMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', awaiting),
    ).toMatchObject({
      value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
    })
  })

  it('fires on attempted work while globally dark and stays quiet at the boundary', () => {
    const perOrganization = healthy()
    perOrganization.notifications.deliveryLag.immediateEmailAcceptance = {
      ...perOrganization.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 1,
      attemptedAwaitingProviderAcceptance: 1,
      oldestAwaitingSourceRecordedAt: '2026-08-20T23:54:59.999Z',
      oldestAwaitingSourceAgeMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', perOrganization),
    ).not.toBeNull()

    const boundary = healthy()
    boundary.notifications.emailDeliveryEnabled = true
    boundary.notifications.deliveryLag.immediateEmailAcceptance = {
      ...boundary.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 1,
      oldestAwaitingSourceRecordedAt: '2026-08-20T23:55:00.000Z',
      oldestAwaitingSourceAgeMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    }
    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', boundary),
    ).toBeNull()
  })

  // The read already excludes capability-dark scopes (their rows are never
  // attempted), so an awaiting row here is mail that may be sent. Requiring
  // accepted or attempted evidence as well hid exactly the allowlisted
  // Organization whose urgent job was never enqueued or never ran.
  it("fires on a sendable scope's untouched backlog without other email evidence", () => {
    const untouched = healthy()
    untouched.notifications.deliveryLag.immediateEmailAcceptance = {
      ...untouched.notifications.deliveryLag.immediateEmailAcceptance,
      awaitingProviderAcceptance: 5,
      oldestAwaitingSourceRecordedAt: '2026-08-20T20:00:00.000Z',
      oldestAwaitingSourceAgeMs: 4 * 60 * 60 * 1000,
    }

    expect(
      evaluateOne('notification.immediate-email-acceptance-lag', untouched),
    ).toMatchObject({ value: 4 * 60 * 60 * 1000 })
  })

  it('fails honestly when active evidence is unlinked or the bounded sample saturates', () => {
    const unlinked = healthy()
    unlinked.notifications.emailDeliveryEnabled = true
    unlinked.notifications.deliveryLag.immediateEmailAcceptance = {
      ...unlinked.notifications.deliveryLag.immediateEmailAcceptance,
      sourceUnlinked: 1,
    }
    const unlinkedEvent = evaluateOne(
      'notification.immediate-email-acceptance-lag',
      unlinked,
    )
    expect(unlinkedEvent?.detail).toContain('durable source')

    const saturated = healthy()
    saturated.notifications.deliveryLag.immediateEmailAcceptance = {
      ...saturated.notifications.deliveryLag.immediateEmailAcceptance,
      acceptedSampleCount: 1_000,
      saturated: true,
    }
    const saturatedEvent = evaluateOne(
      'notification.immediate-email-acceptance-lag',
      saturated,
    )
    expect(saturatedEvent?.detail).toContain('saturated')
  })
})

describe('notification.email-stalled', () => {
  /** An overdue email backlog older than the stall threshold. */
  function overdue(s: MutableSnapshot, extra: Partial<MutableSnapshot['notifications']>) {
    s.notifications = {
      ...s.notifications,
      pendingOverdueCount: 4,
      oldestPendingOverdueAgeMs: NOTIFICATION_EMAIL_STALLED_ALERT_MS + 1,
      ...extra,
    }
    return s
  }

  it('fires when email delivery is enabled and the backlog is past the threshold', () => {
    const event = evaluateOne(
      'notification.email-stalled',
      overdue(healthy(), { emailDeliveryEnabled: true }),
    )

    expect(event).toMatchObject({
      name: 'notification.email-stalled',
      severity: 'P2',
      value: NOTIFICATION_EMAIL_STALLED_ALERT_MS + 1,
      threshold: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    })
    expect(event!.detail).toContain('email delivery is open to every Organization')
  })

  // The cry-wolf guard. With email open to only some Organizations, the queue
  // legitimately holds pending rows a dark scope will never send. If this
  // alert fired on that, it would be firing permanently from day one and
  // would be muted before it ever caught a real fault.
  it('stays silent when outbound email is intentionally capability-dark', () => {
    const s = overdue(healthy(), {
      emailDeliveryEnabled: false,
      attemptedStuckCount: 0,
    })

    expect(evaluateOne('notification.email-stalled', s)).toBeNull()
  })

  // …but a row the delivery path actually TOUCHED is broken regardless of the
  // global flag: that is how a per-org-allowlisted tenant's breakage pages,
  // since an org-scoped grant is not visible in the global readiness fact.
  it('fires while globally dark when the delivery path already attempted rows', () => {
    const s = overdue(healthy(), {
      emailDeliveryEnabled: false,
      attemptedStuckCount: 3,
      oldestAttemptedStuckAgeMs: NOTIFICATION_EMAIL_STALLED_ALERT_MS + 1,
    })

    const event = evaluateOne('notification.email-stalled', s)

    expect(event).not.toBeNull()
    expect(event!.detail).toContain('already attempted')
  })

  // While globally dark, an old UNTOUCHED row is an expected dark-scope
  // backlog; only how long the touched rows have waited is the fault.
  it('judges only the touched rows while globally dark', () => {
    const s = overdue(healthy(), {
      emailDeliveryEnabled: false,
      oldestPendingOverdueAgeMs: 5 * NOTIFICATION_EMAIL_STALLED_ALERT_MS,
      attemptedStuckCount: 1,
      oldestAttemptedStuckAgeMs: 10 * 60 * 1000,
    })

    expect(evaluateOne('notification.email-stalled', s)).toBeNull()
  })

  it('stays silent at the age boundary even with delivery enabled', () => {
    const s = healthy()
    s.notifications = {
      ...s.notifications,
      emailDeliveryEnabled: true,
      pendingOverdueCount: 4,
      oldestPendingOverdueAgeMs: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    }

    expect(evaluateOne('notification.email-stalled', s)).toBeNull()
  })

  it('stays silent when the queue has no overdue rows at all', () => {
    const s = healthy()
    s.notifications = { ...s.notifications, emailDeliveryEnabled: true }

    expect(evaluateOne('notification.email-stalled', s)).toBeNull()
  })
})

// ── what became of attempted email ────────────────────────────────

describe('notification email outcomes', () => {
  function withOutcomes(
    outcomes: Partial<MutableSnapshot['notifications']['emailOutcomes']>,
  ): MutableSnapshot {
    const s = healthy()
    s.notifications.emailOutcomes = { ...s.notifications.emailOutcomes, ...outcomes }
    return s
  }

  it('pages when most attempts are refused permanently — a revoked key or unverified domain', () => {
    const event = evaluateOne(
      'notification.email-permanent-failures',
      withOutcomes({ permanentFailureCount: 3, acceptedCount: 1 }),
    )

    expect(event).toMatchObject({
      name: 'notification.email-permanent-failures',
      severity: 'P2',
      value: 75,
      threshold: NOTIFICATION_EMAIL_PERMANENT_FAILURE_SHARE_ALERT_PERCENT,
      windowMs: NOTIFICATION_EMAIL_OUTCOME_WINDOW_MS,
      runbook: 'runbooks.md §15',
    })
    expect(event!.detail).toContain('3 permanently refused')
    // Refusals with nothing accepted are every attempt.
    expect(
      evaluateOne(
        'notification.email-permanent-failures',
        withOutcomes({
          permanentFailureCount: NOTIFICATION_EMAIL_PERMANENT_FAILURE_MIN_COUNT,
        }),
      ),
    ).toMatchObject({ value: 100 })
  })

  it('stays quiet on isolated refusals among accepted mail', () => {
    expect(
      evaluateOne(
        'notification.email-permanent-failures',
        withOutcomes({ permanentFailureCount: 1, acceptedCount: 1 }),
      ),
    ).toBeNull()
    expect(evaluateOne('notification.email-permanent-failures', healthy())).toBeNull()
  })

  it('stays quiet on a lone refusal with nothing accepted — one bad address in a quiet Organization', () => {
    expect(
      evaluateOne(
        'notification.email-permanent-failures',
        withOutcomes({
          permanentFailureCount: NOTIFICATION_EMAIL_PERMANENT_FAILURE_MIN_COUNT - 1,
        }),
      ),
    ).toBeNull()
  })

  it('pages on a bounce rate above the provider threshold once bounces are not isolated', () => {
    const event = evaluateOne(
      'notification.email-bounce-rate',
      withOutcomes({ bouncedCount: 3, acceptedCount: 40 }),
    )

    expect(event).toMatchObject({
      name: 'notification.email-bounce-rate',
      severity: 'P2',
      value: 7.5,
      threshold: NOTIFICATION_EMAIL_BOUNCE_RATE_ALERT_PERCENT,
    })
    // Isolated bounces are a large rate at beta volume, but not yet a signal.
    expect(
      evaluateOne(
        'notification.email-bounce-rate',
        withOutcomes({
          bouncedCount: NOTIFICATION_EMAIL_BOUNCE_MIN_COUNT - 1,
          acceptedCount: 10,
        }),
      ),
    ).toBeNull()
    expect(
      evaluateOne(
        'notification.email-bounce-rate',
        withOutcomes({ bouncedCount: 3, acceptedCount: 100 }),
      ),
    ).toBeNull()
  })

  it('pages on any spam complaint', () => {
    expect(
      evaluateOne('notification.email-complaints', withOutcomes({ complainedCount: 1 })),
    ).toMatchObject({ severity: 'P2', value: 1, threshold: 0 })
    expect(evaluateOne('notification.email-complaints', healthy())).toBeNull()
  })

  it('pages when the delivery path gives up on transient failures', () => {
    const event = evaluateOne(
      'notification.email-retry-exhausted',
      withOutcomes({ retryExhaustedCount: 2 }),
    )

    expect(event).toMatchObject({ severity: 'P2', value: 2, threshold: 0 })
    expect(event!.detail).toContain('retry budget')
    expect(evaluateOne('notification.email-retry-exhausted', healthy())).toBeNull()
  })

  it('pages when accepted mail never resolves, naming a silent webhook', () => {
    const silent = evaluateOne(
      'notification.email-provider-feedback-missing',
      withOutcomes({
        acceptedCount: 5,
        acceptedUnresolvedCount: 3,
        oldestAcceptedUnresolvedAgeMs: 30 * 60 * 60 * 1000,
      }),
    )

    expect(silent).toMatchObject({
      name: 'notification.email-provider-feedback-missing',
      severity: 'P2',
      value: 3,
      threshold: NOTIFICATION_EMAIL_UNRESOLVED_ALERT_COUNT,
      windowMs: NOTIFICATION_EMAIL_UNRESOLVED_LOOKBACK_MS,
    })
    expect(silent!.detail).toContain('webhook')

    const partial = evaluateOne(
      'notification.email-provider-feedback-missing',
      withOutcomes({
        acceptedUnresolvedCount: 4,
        oldestAcceptedUnresolvedAgeMs: 7 * 60 * 60 * 1000,
        providerOutcomeCount: 12,
      }),
    )
    expect(partial!.detail).toContain('12 provider event(s) did arrive')
    expect(partial!.detail).toContain('delivery_delayed')

    const captured = evaluateOne(
      'notification.email-provider-feedback-missing',
      withOutcomes({
        acceptedUnresolvedCount: 3,
        oldestAcceptedUnresolvedAgeMs: 7 * 60 * 60 * 1000,
        capturedUnresolvedCount: 3,
      }),
    )
    expect(captured!.detail).toContain('3 captured')
  })

  it('stays quiet on a couple of delayed deliveries', () => {
    // A delayed delivery is itself a provider event: the webhook is working.
    expect(
      evaluateOne(
        'notification.email-provider-feedback-missing',
        withOutcomes({
          acceptedUnresolvedCount: NOTIFICATION_EMAIL_UNRESOLVED_ALERT_COUNT,
          oldestAcceptedUnresolvedAgeMs: 7 * 60 * 60 * 1000,
          providerOutcomeCount: 1,
        }),
      ),
    ).toBeNull()
  })

  it('pages on the first unresolved message when no provider event arrived at all', () => {
    // At one Organization's volume three unresolved messages could take days;
    // a silent webhook is already certain after one.
    const silent = evaluateOne(
      'notification.email-provider-feedback-missing',
      withOutcomes({
        acceptedCount: 1,
        acceptedUnresolvedCount: 1,
        oldestAcceptedUnresolvedAgeMs: 7 * 60 * 60 * 1000,
        providerOutcomeCount: 0,
      }),
    )

    expect(silent).toMatchObject({ value: 1 })
    expect(silent!.detail).toContain('webhook looks silent')
  })
})
