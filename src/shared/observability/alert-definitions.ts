// BQC-7.4 — alert definitions: the ONE registry of operational alerts.
//
// Every alert the platform can raise is defined here with owner, severity
// (ADR 0038's P0–P3 taxonomy), threshold/window, and a runbook link (the
// ADR 0038 rule: "every alert links to a runbook"). `evaluate` is a PURE
// function over the OperationsSnapshot (BQC-7.3) plus a narrow aux-reads
// object — unit-testable without DB/Redis; the health-check job gathers the
// inputs and owns all I/O (state store, dispatch).
//
// Scope honesty (phase doc: "Every alert must be injected at least once
// before BQC-8 acceptance"):
//   - Signals the platform cannot observe about itself are REGISTERED here
//     with `implemented: false` and `evaluate: null` — web.availability (a
//     self-reported availability probe is circular; the external synthetic
//     probe that also covers the latency SLO is BQC-8's staging concern),
//     backup.pitr (platform backup status is not app-readable — BQC-7.8's
//     disposition is the platform schedule + the BQC-8 timed restore drill,
//     see the registry entry below), security.scan (CI hard gates — the
//     BQC-7.7 disposition in runbooks.md §9). Their phase-doc injection
//     requirement is satisfied by that external evidence, not app dispatch.
//   - "Multi-window/burn-rate where traffic supports it": beta traffic does
//     not support burn-rate math. Windows here are the honest impact proxies
//     (age thresholds, a 1h denial window, sustained-waiting pool pressure)
//     — no alert pages on a raw count without an impact reading.
//
// Thresholds are named exported constants so the injection suite pins the
// exact contract.

import type { OperationsSnapshot } from '#/shared/health/operations-snapshot'

// ── Types ──────────────────────────────────────────────────────────

/** ADR 0038 severity taxonomy. */
export type AlertSeverity = 'P0' | 'P1' | 'P2' | 'P3'

/**
 * The dispatch payload contract — every field is content-free (ADR 0030):
 * stable names, enums, numbers, and the runbook anchor. No tenant or entity
 * identifiers ever appear here (the 7.3 banned-key policy is asserted over
 * every dispatched field in the injection suite).
 */
export type AlertEvent = Readonly<{
  name: string
  severity: AlertSeverity
  owner: string
  /** runbooks.md section anchor (§N). */
  runbook: string
  /** The measured signal at evaluation time (units per definition). */
  value: number
  /** The breached threshold (same units as value). */
  threshold: number
  /** The window the threshold is judged over (ms). */
  windowMs: number
  /** Content-free human summary for the log line / webhook payload. */
  detail: string
}>

/**
 * Auxiliary reads the OperationsSnapshot does not carry — gathered once per
 * health-check run (5-min cadence) by the job wiring (observability
 * alert-aux-reads.ts). All content-free aggregates.
 */
export type AlertAuxReads = Readonly<{
  /** retention_runs subjects whose LATEST run failed (subject names only). */
  retentionFailedSubjects: readonly string[]
  /** policy_decision_audit denials in the trailing drift window, by reason. */
  policyDenialsByReason: Readonly<Record<string, number>>
  /** Quarantined envelopes carrying a region-attempt policyReason, by reason. */
  routingBlockedByReason: Readonly<Record<string, number>>
  /** Content-free age/count of delivered native feedback awaiting resolution. */
  betaFeedbackTriage: Readonly<{
    /** false means the PostgreSQL observation failed and must alert fail-visible. */
    monitorAvailable: boolean
    deliveredUnresolvedCount: number
    oldestDeliveredUnresolvedAgeMs: number | null
  }>
}>

export type AlertDefinition = Readonly<{
  name: string
  owner: string
  severity: AlertSeverity
  /** runbooks.md anchor (§N). */
  runbook: string
  /** Window the threshold is judged over (ms). */
  windowMs: number
  /** Breach threshold in the definition's value units. */
  threshold: number
  /**
   * false = registered with owner/severity/runbook but the signal source
   * lands in a later slice (evaluate: null — nothing may dispatch it).
   */
  implemented: boolean
  /** Pure evaluation; null exactly when implemented is false. */
  evaluate:
    ((snapshot: OperationsSnapshot, aux: AlertAuxReads) => AlertEvent | null) | null
}>

// ── Thresholds (named, deliberate) ─────────────────────────────────

/**
 * Stale = missing or older than 2× the 5-min health-check cadence — the same
 * semantic as the worker-heartbeat reader (BQR-6.2). Evaluated inside the
 * worker's own health-check run, this catches Redis loss / heartbeat-write
 * failure (the read degrades to stale); a fully-dead worker runs no
 * evaluation at all — that case is the external probe's job (BQC-8, see
 * web.availability + the /api/health/metrics heartbeat field, BQC-7.2).
 */
export const WORKER_HEARTBEAT_STALE_ALERT_MS = 10 * 60 * 1000

/** The relay polls every 5s; an unpublished event older than 15min means the
 *  relay is down, Redis is unreachable, or a backlog is growing. */
export const OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS = 15 * 60 * 1000

/** A quarantined (dead-lettered) job should get an operator redrive decision
 *  within a day; older than 24h means the dead letter is being ignored. */
export const QUARANTINE_REDRIVE_SLA_ALERT_MS = 24 * 60 * 60 * 1000

/**
 * A quarantined job is DROPPED WORK: the quarantine has no worker, and the
 * daily TTL sweep deletes entries after QUARANTINE_TTL_DAYS. So a job that
 * lands there is silently lost unless an operator redrives it — which is why
 * this threshold is low and the severity is a page, while the 24h
 * `queue.quarantine-growth` above is only the redrive-SLA nag. 15min (3× the
 * 5-min evaluation cadence) is the sustainment proxy: it clears a transient
 * entry an operator is actively redriving without waiting out a whole day.
 */
export const QUARANTINE_NONEMPTY_ALERT_MS = 15 * 60 * 1000

/**
 * The discover-new-reviews sweep FIRES every 15 minutes (worker/index.ts is
 * the source of truth; shared cannot import a context module, so the cadence
 * is mirrored here). Anything overdue is pure sweep lag — the per-property
 * poll interval is already priced into next_incremental_at.
 */
const DISCOVERY_SWEEP_INTERVAL_MS = 15 * 60 * 1000

/**
 * Four consecutive sweeps failed to reach the oldest due property. One
 * missed sweep is a queue hiccup; four is the sweep being dead, starving, or
 * throwing — and with Google push dark, the sweep IS the only path a new
 * review has into the app. Hence P1 on an hour of lag.
 */
export const SYNC_SWEEP_LAG_ALERT_MS = 4 * DISCOVERY_SWEEP_INTERVAL_MS

/**
 * A queued notification email overdue by more than 2h. The digest sweep runs
 * hourly and the urgent path is immediate, so 2h is two missed digest ticks —
 * past any legitimate cadence, batching, or retry backoff.
 */
export const NOTIFICATION_EMAIL_STALLED_ALERT_MS = 2 * 60 * 60 * 1000

/**
 * Approved in-app target measured from the durable source fact. This alert is
 * an oldest-outstanding breach signal, not a claim that one snapshot proves a
 * latency percentile; deployed p99 evidence remains a separate release gate.
 */
export const NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS = 60 * 1000

/**
 * Approved provider-acceptance target for immediate operational email,
 * measured from the durable source fact rather than queue insertion time.
 */
export const NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS = 5 * 60 * 1000

/**
 * Source freshness approaching the policy deadline: fire when the nearest
 * hard expiry among refresh-due rows is under 2 days away — the operator
 * still has room to act before content hard-expires (BQC-1.5 signal).
 */
export const SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS = 2 * 24 * 60 * 60

/** An ambiguous reply publication past reconcile_due by more than 15min —
 *  the 30-min reconcile sweep should have picked it up. */
export const REPLY_AMBIGUOUS_ALERT_MS = 15 * 60 * 1000

/**
 * Deployment-drift signal: denials in the trailing hour above this count
 * indicate a mis-deployed policy/config, not organic traffic. STARTING POINT
 * — tune with real beta traffic (the 1h window + threshold is the impact
 * proxy; the phase doc forbids paging on raw counts without impact).
 */
export const POLICY_DENIAL_DRIFT_THRESHOLD = 50
export const POLICY_DENIAL_DRIFT_WINDOW_MS = 60 * 60 * 1000

/**
 * A delivered native-feedback report unresolved for three days is an
 * operational backlog. The support target remains a next-business-day
 * expectation rather than an SLA; 72h avoids a permanent weekend page while
 * still making an abandoned queue visible.
 */
export const BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS = 72 * 60 * 60 * 1000

/** Redis monitor retention/read window for suppressed Guest observations. */
const GUEST_OBSERVATION_LOSS_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000

/** The health-check evaluation cadence (the job's 5-min schedule). */
const EVAL_CADENCE_MS = 5 * 60 * 1000

/** The one escalation owner (runbooks.md). */
const OWNER = 'Bozhidar Denev'

/**
 * Wrong/unresolved region attempts (phase doc): the delayed-execution gate's
 * region-deny quarantine reasons. `routing_blocked:property_missing` is a
 * data problem, not a region attempt, and stays out of this alert.
 */
export const REGION_ATTEMPT_REASONS = [
  'routing_blocked:region_denied',
  'routing_blocked:region_unresolved',
  'wrong_cell',
] as const

// ── Definition helper ──────────────────────────────────────────────

/** The per-evaluation reading a definition produces when it breaches. */
type AlertReading = Readonly<{ value: number; detail: string }>

/**
 * Build an implemented definition: the static identity (name/severity/
 * runbook/threshold/window) is declared once; `read` returns only the
 * measured value + detail on breach. The wrapped evaluate assembles the
 * full dispatch event.
 */
function define(
  def: Readonly<{
    name: string
    severity: AlertSeverity
    runbook: string
    windowMs: number
    threshold: number
    read: (snapshot: OperationsSnapshot, aux: AlertAuxReads) => AlertReading | null
  }>,
): AlertDefinition {
  const { read, ...statics } = def
  return {
    ...statics,
    owner: OWNER,
    implemented: true,
    evaluate: (snapshot, aux) => {
      const reading = read(snapshot, aux)
      if (reading === null) return null
      return { ...statics, owner: OWNER, value: reading.value, detail: reading.detail }
    },
  }
}

/** Registered-but-not-yet-implemented definition (later-slice signal). */
function registered(
  def: Readonly<{
    name: string
    severity: AlertSeverity
    runbook: string
    windowMs: number
    threshold: number
  }>,
): AlertDefinition {
  return { ...def, owner: OWNER, implemented: false, evaluate: null }
}

function sumReasons(byReason: Readonly<Record<string, number>>): number {
  return Object.values(byReason).reduce((a, b) => a + b, 0)
}

function reasonSplit(byReason: Readonly<Record<string, number>>): string {
  return Object.entries(byReason)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ')
}

// ── Definitions ────────────────────────────────────────────────────

export const ALERT_DEFINITIONS: readonly AlertDefinition[] = [
  // ── web/worker availability and latency ──
  define({
    name: 'worker.heartbeat.stale',
    severity: 'P1',
    runbook: 'runbooks.md §7',
    windowMs: WORKER_HEARTBEAT_STALE_ALERT_MS,
    threshold: WORKER_HEARTBEAT_STALE_ALERT_MS,
    read: (snapshot) => {
      const hb = snapshot.workers.heartbeat
      if (
        !hb.stale &&
        (hb.ageMs == null || hb.ageMs <= WORKER_HEARTBEAT_STALE_ALERT_MS)
      ) {
        return null
      }
      // -1 marks "no heartbeat recorded" (the value stays a finite number).
      return {
        value: hb.ageMs ?? -1,
        detail:
          hb.ageMs == null
            ? 'worker heartbeat missing — worker down or Redis unreachable'
            : `worker heartbeat age ${hb.ageMs}ms exceeds ${WORKER_HEARTBEAT_STALE_ALERT_MS}ms`,
      }
    },
  }),
  // The heartbeat proves that a process is alive; this separately proves
  // that every governed family is registered, scheduled, fresh, unpoisoned,
  // and assigned to an executable repair path in the observed cell.
  define({
    name: 'worker.job-runtime-unready',
    severity: 'P1',
    runbook: 'runbooks.md §17',
    windowMs: EVAL_CADENCE_MS,
    threshold: 0,
    read: (snapshot) => {
      const jobs = snapshot.jobs
      if (!jobs) {
        return {
          value: 1,
          detail:
            'governed job runtime report unavailable — registration, freshness, dark-work, and repair state are unknown',
        }
      }
      if (jobs.ready) return null
      return {
        value: Math.max(1, jobs.failing),
        detail:
          `${jobs.failing} of ${jobs.total} governed job families unready; ` +
          `missingObservations=${jobs.missingObservations}, ` +
          `handlerMissing=${jobs.handlerMissing}, ` +
          `schedulerMissing=${jobs.schedulerMissing}, ` +
          `forbiddenDarkWork=${jobs.forbiddenDarkWork}, ` +
          `quarantinedSchedulers=${jobs.quarantinedSchedulers}, ` +
          `missedObjectives=${jobs.missedObjectives}, ` +
          `queueAgeMissed=${jobs.queueAgeMissed}, stalled=${jobs.stalled}, ` +
          `repairRequired=${jobs.repairRequired}, deadLetters=${jobs.deadLetters}`,
      }
    },
  }),
  // NOT self-reportable: a process reporting its own availability is
  // circular. The external synthetic probe (uptime monitor hitting the
  // deployed web service — it also measures the ADR 0038 p95 ≤ 750ms
  // latency SLO from outside) is BQC-8's staging concern. Registered here
  // so the alert surface is complete and honest about the signal source.
  registered({
    name: 'web.availability',
    severity: 'P1',
    runbook: 'runbooks.md §12',
    windowMs: EVAL_CADENCE_MS,
    threshold: 0,
  }),
  // A private rating is deliberately not part of this signal: its canonical
  // response fact and outbox row commit atomically, and ordinary retryable
  // command failures are not analytics loss. This alert covers only the two
  // public actions whose approved journey intentionally survives a lost
  // best-effort observation.
  define({
    name: 'guest.observation-loss',
    severity: 'P1',
    runbook: 'runbooks.md §18',
    windowMs: GUEST_OBSERVATION_LOSS_ALERT_WINDOW_MS,
    threshold: 0,
    read: (snapshot) => {
      const loss = snapshot.guestObservationLoss
      if (!loss || !loss.monitorAvailable) {
        return {
          value: 1,
          detail:
            'Guest observation-loss monitor unavailable or warming after reset — scan and review-link measurement completeness is unknown; ratings=not_applicable_durable',
        }
      }
      if (loss.totalLossCount <= 0) return null
      return {
        value: loss.totalLossCount,
        detail:
          `${loss.totalLossCount} Guest best-effort observation(s) lost in the trailing window; ` +
          `scans=${loss.scanLossCount}, reviewLinks=${loss.reviewLinkLossCount}, ` +
          'ratings=not_applicable_durable',
      }
    },
  }),

  // ── queue oldest age and stalled/quarantine growth ──
  define({
    name: 'queue.oldest-age',
    severity: 'P2',
    runbook: 'runbooks.md §7',
    windowMs: OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS,
    threshold: OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS,
    read: (snapshot) => {
      const age = snapshot.outbox.oldestUnpublishedAgeMs
      if (age == null || age <= OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS) return null
      return {
        value: age,
        detail: `oldest unpublished outbox event is ${age}ms old (threshold ${OUTBOX_OLDEST_UNPUBLISHED_ALERT_MS}ms) — relay down or backlog growing`,
      }
    },
  }),
  // Single-evaluation honesty: a stalled lease (claim held beyond 2× its
  // lease without publishing) IS the impact — work stopped mid-flight — not
  // a raw count. No multi-eval sustainment required.
  define({
    name: 'queue.stalled',
    severity: 'P2',
    runbook: 'runbooks.md §7',
    windowMs: EVAL_CADENCE_MS,
    threshold: 0,
    read: (snapshot) => {
      const count = snapshot.outbox.stalledLeaseCount
      if (count <= 0) return null
      return {
        value: count,
        detail: `${count} stalled outbox lease(s) — claim(s) held beyond 2x lease without publishing`,
      }
    },
  }),
  define({
    name: 'queue.quarantine-growth',
    severity: 'P2',
    runbook: 'runbooks.md §4',
    windowMs: QUARANTINE_REDRIVE_SLA_ALERT_MS,
    threshold: QUARANTINE_REDRIVE_SLA_ALERT_MS,
    read: (snapshot) => {
      const q = snapshot.quarantine
      if (q == null || q.count <= 0) return null
      if (q.oldestAgeMs == null || q.oldestAgeMs <= QUARANTINE_REDRIVE_SLA_ALERT_MS)
        return null
      return {
        value: q.oldestAgeMs,
        detail: `oldest of ${q.count} quarantined job(s) is ${q.oldestAgeMs}ms old — past the 24h operator redrive SLA`,
      }
    },
  }),
  // The quarantine has NO consumer and the daily TTL sweep deletes entries:
  // an unredriven job is silently dropped work, not a backlog. This fires on
  // presence-with-sustainment (15min ≈ 3 evaluation cadences) so the loss is
  // visible while it is still recoverable; `queue.quarantine-growth` above is
  // the same condition aged past the 24h redrive SLA (§4).
  define({
    name: 'queue.quarantine-nonempty',
    severity: 'P1',
    runbook: 'runbooks.md §14',
    windowMs: QUARANTINE_NONEMPTY_ALERT_MS,
    threshold: QUARANTINE_NONEMPTY_ALERT_MS,
    read: (snapshot) => {
      const q = snapshot.quarantine
      if (q == null || q.count <= 0) return null
      if (q.oldestAgeMs == null || q.oldestAgeMs <= QUARANTINE_NONEMPTY_ALERT_MS) {
        return null
      }
      return {
        value: q.oldestAgeMs,
        detail: `${q.count} job(s) sitting in the unconsumed quarantine, oldest ${q.oldestAgeMs}ms — dropped work: no worker drains it and the TTL sweep deletes it`,
      }
    },
  }),

  // ── Google/source freshness approaching the policy deadline ──
  define({
    name: 'source.freshness-deadline',
    severity: 'P1',
    runbook: 'runbooks.md §3',
    windowMs: SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS * 1000,
    threshold: SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS,
    read: (snapshot) => {
      const { refreshDueCount, oldestDueAgeSeconds } = snapshot.reviews
      // oldestDueAgeSeconds counts DOWN toward the hard expiry — the breach
      // direction is reversed (below the mark = approaching the deadline).
      if (refreshDueCount <= 0) return null
      if (oldestDueAgeSeconds == null) return null
      if (oldestDueAgeSeconds >= SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS) return null
      return {
        value: oldestDueAgeSeconds,
        detail: `${refreshDueCount} refresh-due review(s); nearest hard expiry in ${oldestDueAgeSeconds}s — under the ${SOURCE_FRESHNESS_DEADLINE_ALERT_SECONDS}s action mark`,
      }
    },
  }),

  // A due coded failure is known broken work, not raw traffic volume. One
  // evaluation is enough to notify without escalating a single failure to P1.
  define({
    name: 'sync.failed-nonzero',
    severity: 'P2',
    runbook: 'runbooks.md §13',
    windowMs: EVAL_CADENCE_MS,
    threshold: 0,
    read: (snapshot) => {
      const count = snapshot.sync.failedSyncCount
      if (count <= 0) return null
      return {
        value: count,
        detail: `${count} Review sync(s) have a coded failure whose retry is due`,
      }
    },
  }),

  // ── new reviews not arriving: the discovery sweep has fallen behind ──
  // The freshness alert above watches CONTENT expiry on reviews we already
  // hold. This one watches whether we are still finding new ones. It reads
  // the oldest-overdue AGE, not the due count: a count cannot tell a healthy
  // sweep mid-run (many properties, all due seconds ago) from a dead one (one
  // property, due since yesterday).
  define({
    name: 'sync.sweep-lag',
    severity: 'P1',
    runbook: 'runbooks.md §13',
    windowMs: SYNC_SWEEP_LAG_ALERT_MS,
    threshold: SYNC_SWEEP_LAG_ALERT_MS,
    read: (snapshot) => {
      const { dueForIncrementalCount, oldestDueAgeMs, gbpPushEnabled } = snapshot.sync
      if (dueForIncrementalCount <= 0) return null
      if (oldestDueAgeMs == null || oldestDueAgeMs <= SYNC_SWEEP_LAG_ALERT_MS) return null
      // Push state is context, not a suppressor: the sweep is the only path
      // when push is dark, and the safety net when it is live.
      const pushState = gbpPushEnabled ? 'push live' : 'push DARK'
      return {
        value: oldestDueAgeMs,
        detail: `${dueForIncrementalCount} property(ies) due for incremental sync; oldest overdue by ${oldestDueAgeMs}ms (> ${SYNC_SWEEP_LAG_ALERT_MS}ms = 4 missed sweeps, ${pushState}) — new reviews are not arriving`,
      }
    },
  }),

  // ── the user was never told ──
  // A review landed, the inbox has it, and no notification exists after the
  // grace edge. The bounded reconciliation sweep is the repair authority, so
  // presence means either delivery is late or that repair is not keeping up.
  define({
    name: 'notification.missing-for-inbox-item',
    severity: 'P1',
    runbook: 'runbooks.md §15',
    windowMs: EVAL_CADENCE_MS,
    threshold: 0,
    read: (snapshot) => {
      const count = snapshot.notifications.missingForInboxItemCount
      if (count <= 0) return null
      return {
        value: count,
        detail: `${count} inbox item(s) still have no notification past the grace edge — delivery or bounded reconciliation is not keeping up`,
      }
    },
  }),
  define({
    name: 'notification.in-app-delivery-lag',
    severity: 'P1',
    runbook: 'runbooks.md §15',
    windowMs: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    threshold: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS,
    read: (snapshot) => {
      const lag = snapshot.notifications.deliveryLag
      const pending = lag.sourceReceiptPending + lag.materializationPending
      if (pending <= 0) return null
      const relevantAges = [
        lag.sourceReceiptPending > 0 ? lag.oldestSourceAgeMs : null,
        lag.materializationPending > 0 ? lag.oldestMaterializationSourceAgeMs : null,
      ].filter((age): age is number => age !== null)
      const oldestSourceAgeMs =
        relevantAges.length === 0 ? null : Math.max(...relevantAges)
      const sourceCount = `${lag.sourceReceiptPending}${lag.sourceSaturated ? '+' : ''}`
      const materializationCount = `${lag.materializationPending}${lag.materializationSaturated ? '+' : ''}`
      if (oldestSourceAgeMs === null) {
        return {
          value: NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS + 1,
          detail: `notification delivery pending without a valid durable-source clock (source receipts=${sourceCount}, materializations=${materializationCount})`,
        }
      }
      if (oldestSourceAgeMs <= NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS) {
        return null
      }
      return {
        value: oldestSourceAgeMs,
        detail: `notification delivery from durable source is ${oldestSourceAgeMs}ms old (> ${NOTIFICATION_IN_APP_DELIVERY_LAG_ALERT_MS}ms; source receipts=${sourceCount}, materializations=${materializationCount})`,
      }
    },
  }),
  define({
    name: 'notification.immediate-email-acceptance-lag',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    windowMs: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    threshold: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS,
    read: (snapshot) => {
      const email = snapshot.notifications.deliveryLag.immediateEmailAcceptance
      if (email.sourceUnlinked > 0) {
        return {
          value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
          detail: `${email.sourceUnlinked} immediate notification email row(s) have no active durable source clock; the five-minute acceptance target cannot be evaluated`,
        }
      }
      const activeEvidence =
        snapshot.notifications.emailDeliveryEnabled ||
        email.acceptedSampleCount > 0 ||
        email.attemptedAwaitingProviderAcceptance > 0
      if (!activeEvidence) return null

      if (email.saturated) {
        return {
          value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
          detail: `immediate notification email acceptance evidence saturated its bounded scan (accepted samples observed=${email.acceptedSampleCount}); the full-window p99 is unavailable`,
        }
      }
      if (email.acceptedSampleCount > 0 && email.acceptedLatencyP99Ms === null) {
        return {
          value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
          detail: `immediate notification email has ${email.acceptedSampleCount} accepted row(s) but no valid durable-source p99 clock`,
        }
      }
      if (
        email.awaitingProviderAcceptance > 0 &&
        email.oldestAwaitingSourceAgeMs === null
      ) {
        return {
          value: NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS + 1,
          detail: `${email.awaitingProviderAcceptance} immediate notification email row(s) await provider acceptance without a valid durable source clock`,
        }
      }

      const measured = [
        email.acceptedSampleCount > 0 ? email.acceptedLatencyP99Ms : null,
        email.awaitingProviderAcceptance > 0 ? email.oldestAwaitingSourceAgeMs : null,
      ].filter((value): value is number => value !== null)
      const worstMs = measured.length === 0 ? null : Math.max(...measured)
      if (
        worstMs === null ||
        worstMs <= NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS
      ) {
        return null
      }
      return {
        value: worstMs,
        detail: `immediate notification email provider acceptance is ${worstMs}ms from durable source (> ${NOTIFICATION_IMMEDIATE_EMAIL_ACCEPTANCE_ALERT_MS}ms; p99 sample=${email.acceptedSampleCount}, awaiting=${email.awaitingProviderAcceptance})`,
      }
    },
  }),
  // Queued email that is not going out. The cry-wolf guard is the point:
  // outbound email is capability-dark today, so a pending backlog is the
  // EXPECTED state and must stay silent. It fires only when email is
  // globally enabled (so the backlog is a real fault) or when the delivery
  // path already attempted the row and left it pending — which is a fault
  // regardless of the global flag, and is how a per-org-allowlisted tenant's
  // breakage still pages.
  define({
    name: 'notification.email-stalled',
    severity: 'P2',
    runbook: 'runbooks.md §15',
    windowMs: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    threshold: NOTIFICATION_EMAIL_STALLED_ALERT_MS,
    read: (snapshot) => {
      const {
        emailDeliveryEnabled,
        pendingOverdueCount,
        oldestPendingOverdueAgeMs,
        attemptedStuckCount,
      } = snapshot.notifications
      if (pendingOverdueCount <= 0) return null
      if (
        oldestPendingOverdueAgeMs == null ||
        oldestPendingOverdueAgeMs <= NOTIFICATION_EMAIL_STALLED_ALERT_MS
      ) {
        return null
      }
      if (!emailDeliveryEnabled && attemptedStuckCount <= 0) return null
      const cause = emailDeliveryEnabled
        ? 'email delivery is enabled'
        : `email delivery is globally dark but ${attemptedStuckCount} row(s) were already attempted`
      return {
        value: oldestPendingOverdueAgeMs,
        detail: `${pendingOverdueCount} queued notification email(s) overdue, oldest by ${oldestPendingOverdueAgeMs}ms (> ${NOTIFICATION_EMAIL_STALLED_ALERT_MS}ms) — ${cause}`,
      }
    },
  }),

  // ── purge/retention failure ──
  // The retention sweep runs daily; the signal is the LATEST run per
  // subject — one failed sweep must page before the next one is due.
  define({
    name: 'retention.failure',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    windowMs: 24 * 60 * 60 * 1000,
    threshold: 0,
    read: (_snapshot, aux) => {
      const failed = aux.retentionFailedSubjects
      if (failed.length === 0) return null
      return {
        value: failed.length,
        detail: `latest retention run failed for: ${failed.join(', ')}`,
      }
    },
  }),

  // ── native beta-feedback triage backlog ──
  // Only the content-free local receipt is observed here. Report text and
  // attachment bytes remain outside PostgreSQL and cannot enter the event.
  define({
    name: 'beta-feedback.triage-backlog',
    severity: 'P2',
    runbook: 'runbooks.md §16',
    windowMs: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
    threshold: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
    read: (_snapshot, aux) => {
      const triage = aux.betaFeedbackTriage
      if (!triage.monitorAvailable) {
        return {
          value: -1,
          detail: 'beta-feedback triage backlog monitor unavailable',
        }
      }
      if (triage.deliveredUnresolvedCount <= 0) return null
      const ageMs = triage.oldestDeliveredUnresolvedAgeMs
      if (ageMs == null) {
        return {
          value: -1,
          detail: 'beta-feedback triage backlog monitor returned an incomplete reading',
        }
      }
      if (ageMs <= BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS) return null
      return {
        value: ageMs,
        detail: `${triage.deliveredUnresolvedCount} delivered unresolved beta-feedback report(s); oldest age ${ageMs}ms`,
      }
    },
  }),

  // ── publication ambiguity ──
  define({
    name: 'reply.ambiguous-aging',
    severity: 'P2',
    runbook: 'runbooks.md §6',
    windowMs: REPLY_AMBIGUOUS_ALERT_MS,
    threshold: REPLY_AMBIGUOUS_ALERT_MS,
    read: (snapshot) => {
      const { counts, oldestAmbiguousAgeMs } = snapshot.replyPublication
      if ((counts.ambiguous ?? 0) <= 0) return null
      if (
        oldestAmbiguousAgeMs == null ||
        oldestAmbiguousAgeMs <= REPLY_AMBIGUOUS_ALERT_MS
      ) {
        return null
      }
      return {
        value: oldestAmbiguousAgeMs,
        detail: `oldest ambiguous reply publication is ${oldestAmbiguousAgeMs}ms past reconcile_due — the 30-min reconcile sweep is not keeping up`,
      }
    },
  }),

  // ── wrong/unresolved region attempts ──
  // Point-in-time read of the quarantine content at each evaluation; the
  // quarantine is operator-drained, so presence = an unactioned attempt.
  define({
    name: 'routing.region-attempts',
    severity: 'P2',
    runbook: 'runbooks.md §12',
    windowMs: EVAL_CADENCE_MS,
    threshold: 0,
    read: (_snapshot, aux) => {
      const total = sumReasons(aux.routingBlockedByReason)
      if (total <= 0) return null
      return {
        value: total,
        detail: `${total} wrong/unresolved region attempt(s) quarantined (${reasonSplit(aux.routingBlockedByReason)})`,
      }
    },
  }),

  // ── repeated policy/config denial indicating deployment drift ──
  define({
    name: 'policy.denial-drift',
    severity: 'P2',
    runbook: 'runbooks.md §9',
    windowMs: POLICY_DENIAL_DRIFT_WINDOW_MS,
    threshold: POLICY_DENIAL_DRIFT_THRESHOLD,
    read: (_snapshot, aux) => {
      const total = sumReasons(aux.policyDenialsByReason)
      if (total <= POLICY_DENIAL_DRIFT_THRESHOLD) return null
      return {
        value: total,
        detail: `${total} policy denials in the last hour (threshold ${POLICY_DENIAL_DRIFT_THRESHOLD}) — possible deployment drift (${reasonSplit(aux.policyDenialsByReason)})`,
      }
    },
  }),

  // ── DB/Redis capacity/connection exhaustion ──
  // Sustained waiting = requests queue behind a saturated pool — the
  // connection-exhaustion impact signal (evaluated each cadence). Redis
  // capacity/loss surfaces through worker.heartbeat.stale (§7).
  define({
    name: 'db.pool-exhaustion',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    windowMs: EVAL_CADENCE_MS,
    threshold: 0,
    read: (snapshot) => {
      const pool = snapshot.db.pool
      if (pool == null || pool.waitingCount <= 0) return null
      return {
        value: pool.waitingCount,
        detail: `${pool.waitingCount} connection request(s) queued behind a saturated pool (${pool.totalCount}/${pool.max} in use)`,
      }
    },
  }),

  // ── backup/PITR failure + security scan/secret detection failure ──
  // BQC-7.8 disposition — deliberately NOT implemented at app level: the
  // platform's backup/PITR status is not readable from the app (Railway
  // Postgres backups are console/provider state; there is no app-readable
  // signal to evaluate, so no aux-read seam exists for it). The signal
  // source is the platform backup schedule + restore drill evidence:
  // configuration + procedure live in docs/operations/backup-and-lifecycle.md,
  // and the phase-doc injection requirement is satisfied by the BQC-8 TIMED
  // restore drill (RPO ≤ 15min per ADR 0038), not by app dispatch. Registered
  // so the alert surface is complete.
  registered({
    name: 'backup.pitr',
    severity: 'P3',
    runbook: 'runbooks.md §8',
    windowMs: 24 * 60 * 60 * 1000,
    threshold: 0,
  }),
  // BQC-7.7 disposition — deliberately NOT implemented at app level: the
  // supply-chain/secret-detection gates are CI HARD GATES (a red gate fails
  // the GitHub check and blocks merge — pre-deploy evidence, not a
  // production signal). Documented in runbooks.md §9 +
  // docs/operations/security-ci-policy.md. Registered so the alert surface
  // is complete.
  registered({
    name: 'security.scan',
    severity: 'P2',
    runbook: 'runbooks.md §9',
    windowMs: 24 * 60 * 60 * 1000,
    threshold: 0,
  }),
]

/** Names of the alerts the health-check job evaluates and tracks state for. */
export function implementedAlertNames(): readonly string[] {
  return ALERT_DEFINITIONS.filter((d) => d.implemented).map((d) => d.name)
}

export type AlertEvaluation = Readonly<{
  /** Newly-firing alerts (ok→firing edge) to dispatch now. */
  toDispatch: readonly AlertEvent[]
  /** All currently-firing alert names (state-store reconciliation input). */
  firing: readonly string[]
}>

/**
 * Pure evaluation pass: run every implemented definition against the
 * snapshot + aux reads. Edge-trigger hysteresis is expressed through
 * `previouslyFiring`: an alert already in the firing state does NOT
 * re-dispatch. The caller persists the state (Redis, 24h TTL) — a
 * continuously-firing alert re-notifies only after its state key expires,
 * and the caller clears state on recovery (name absent from `firing`).
 */
export function evaluateAlerts(
  snapshot: OperationsSnapshot,
  aux: AlertAuxReads,
  previouslyFiring: ReadonlySet<string>,
): AlertEvaluation {
  const toDispatch: AlertEvent[] = []
  const firing: string[] = []
  for (const def of ALERT_DEFINITIONS) {
    if (!def.implemented || def.evaluate === null) continue
    const event = def.evaluate(snapshot, aux)
    if (event === null) continue
    firing.push(def.name)
    if (!previouslyFiring.has(def.name)) toDispatch.push(event)
  }
  return { toDispatch, firing }
}
