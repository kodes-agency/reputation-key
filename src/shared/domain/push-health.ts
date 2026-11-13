// Push health: what "missed" and "late" mean for a Google push, and when a
// location or an account is suspect or dark (ADR 0055).
//
// Pure rules over the first-sighting ledger (`review_first_sightings`, written
// by the Review writer). The read side (shared/db/sync-push-health.ts) fetches
// the rows polling found first and judges each one here, so there is exactly
// one definition. Nothing here reads the clock: `now` is passed in.

/**
 * How a Review was first seen. `push` and `push_reconcile` are the two Google
 * push routes (a targeted read, and the full snapshot a push whose reference
 * was lost hands off to); `snapshot` is polling; `head` and `demand` are the
 * one-call newest-page check and the reads made on demand (a reply or a
 * reminder re-reading one Review). The database CHECK on
 * `review_first_sightings.first_seen_via` lists the same values.
 */
export type ReviewFirstSeenVia =
  'push' | 'push_reconcile' | 'snapshot' | 'head' | 'demand'

/** A Review with no push accepted this long after it was first seen is MISSED. */
export const PUSH_MISSED_AFTER_MS = 60 * 60 * 1000

/**
 * A push is paired with a Review polling saw first only if Pub/Sub accepted it
 * within this long of the first sighting. Google reports an edit with the same
 * notification kind as an arrival, so a push days later is an edit of a Review
 * whose own push never came, and must not turn that miss into a late push.
 */
export const PUSH_PAIRING_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Fallback when no previous completed listing is known: a Review Google dates
 * more than this long before RepKey first saw it is treated as published late.
 * Google does not reliably announce those (ADR 0055, note 2026-11-01).
 */
export const LATE_PUBLISHED_AFTER_MS = 24 * 60 * 60 * 1000

/** The window a location's or an account's health is judged over. */
export const PUSH_HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** The window the alerts count over. */
export const PUSH_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000

/** Slack on top of a Property's window before its reconciliation is overdue. */
export const RECONCILIATION_OVERDUE_SLACK_MS = 2 * 60 * 60 * 1000

/**
 * A syncable Property is reconciliation-overdue past this age. The discovery
 * window is REVIEW_RECONCILE_WITHIN_HOURS; two hours of slack on top keeps one
 * slow sweep and its snapshot from paging (ADR 0055).
 */
export function reconciliationOverdueAfterMs(reconcileWithinHours: number): number {
  return reconcileWithinHours * 60 * 60 * 1000 + RECONCILIATION_OVERDUE_SLACK_MS
}

/** Default limit while the reconciliation window remains six hours. */
export const RECONCILIATION_OVERDUE_AFTER_MS = reconciliationOverdueAfterMs(6)

/**
 * The widest REVIEW_RECONCILE_WITHIN_HOURS accepts: fourteen days. Google allows
 * stored review text only while it is refreshed within 30 days.
 */
export const RECONCILE_WITHIN_HOURS_MAX = 14 * 24

/**
 * Above this window a Property skips the full listing only while a persisting
 * head check covers its newest page; without that cover it is listed in full
 * once its last listing is this old.
 */
export const UNCOVERED_RECONCILE_WITHIN_MS = 24 * 60 * 60 * 1000

/**
 * A persisting head check that stored all of Google's newest page covers the
 * Property for this long: the longest gap between two discovery looks (six
 * hours, the ladder's cold rung) plus an hour for the start spread and the
 * queue.
 */
export const HEAD_COVERAGE_FRESH_MS = 7 * 60 * 60 * 1000

/**
 * The longest gap between two discovery looks (the ladder's cold rung). The
 * look that first finds a Property's cover lapsed comes at most this long after
 * the lapse; the reconciliation-age read allows for it.
 */
export const DISCOVERY_LOOK_MAX_GAP_MS = 6 * 60 * 60 * 1000

/** The head-coverage alert counts Properties left without cover this long. */
export const HEAD_COVERAGE_ALERT_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Head checks ask for full reads about a drop in Google's review total for this
 * long after they first saw it: twelve reads at most, one per six hours. A drop
 * still there afterwards is not one a listing resolves, so the checks stop
 * asking and the count-drop alert counts the Property instead.
 */
export const COUNT_DROP_PERSISTENT_AFTER_MS = 72 * 60 * 60 * 1000

/**
 * The count-drop alert counts a drop only while a head check saw it this
 * recently: the longest gap between two looks plus an hour for the start spread
 * and the queue. A Property whose head checks stopped (every look a full
 * listing, or checks turned off) keeps no standing alarm on an old sighting.
 */
export const COUNT_DROP_CHECKED_FRESH_MS = DISCOVERY_LOOK_MAX_GAP_MS + 60 * 60 * 1000

/** A location is suspect after this many missed pushes in the health window. */
const LOCATION_SUSPECT_MISSED = 1

/** An account is dark when this many pushes were missed across its locations. */
const ACCOUNT_DARK_MISSED = 2

/**
 * The ways RepKey first saw a Review that a Google push already covers: the
 * push's own targeted read, and the full snapshot a push handed off to when
 * its target could not be read.
 */
export const PUSH_COVERED_VIA = ['push', 'push_reconcile'] as const

const PUSH_COVERED: ReadonlySet<ReviewFirstSeenVia> = new Set(PUSH_COVERED_VIA)

export type FirstSightingFacts = Readonly<{
  firstSeenVia: ReviewFirstSeenVia
  firstSeenAt: Date
  /** When Pub/Sub accepted the push for this Review; null when none was paired. */
  pushAcceptedAt: Date | null
  /** The date Google gives the Review; null when the read has none for it. */
  sourceCreatedAt: Date | null
  /** The Property's last completed listing before this first sighting, in its source epoch. */
  previousListingAt: Date | null
}>

/**
 * `late` and `missed` are not exclusive: a push that arrives after the missed
 * window makes the Review late as well, and it stays counted as missed. A
 * Review is `pending` until a push is paired with it or the window passes.
 */
export type PushCoverage = Readonly<{
  healthy: boolean
  pending: boolean
  late: boolean
  missed: boolean
}>

function publishedLate(sighting: FirstSightingFacts): boolean {
  if (sighting.sourceCreatedAt === null) return false
  const createdAt = sighting.sourceCreatedAt.getTime()
  // A Review dated before a listing that did not contain it was published late.
  if (sighting.previousListingAt !== null) {
    return createdAt < sighting.previousListingAt.getTime()
  }
  return sighting.firstSeenAt.getTime() - createdAt > LATE_PUBLISHED_AFTER_MS
}

/** Judge one first sighting at `now`. */
export function classifyFirstSighting(
  sighting: FirstSightingFacts,
  now: Date,
): PushCoverage {
  const seenAt = sighting.firstSeenAt.getTime()
  const accepted = sighting.pushAcceptedAt?.getTime() ?? null
  const healthy =
    PUSH_COVERED.has(sighting.firstSeenVia) ||
    (accepted !== null && accepted <= seenAt) ||
    publishedLate(sighting)
  if (healthy) return { healthy: true, pending: false, late: false, missed: false }

  const windowEndsAt = seenAt + PUSH_MISSED_AFTER_MS
  const late = accepted !== null
  const missed =
    now.getTime() >= windowEndsAt && (accepted === null || accepted > windowEndsAt)
  return { healthy: false, pending: !late && !missed, late, missed }
}

export type LocationPushHealth = 'healthy' | 'suspect'

/** One location's health from the pushes it missed in the health window. */
export function locationPushHealth(missedInWindow: number): LocationPushHealth {
  return missedInWindow >= LOCATION_SUSPECT_MISSED ? 'suspect' : 'healthy'
}

export type AccountPushHealth = 'ok' | 'dark'

/** One Google account's health from the pushes missed across its locations. */
export function accountPushHealth(missedAcrossLocations: number): AccountPushHealth {
  return missedAcrossLocations >= ACCOUNT_DARK_MISSED ? 'dark' : 'ok'
}

/** One first sighting polling (or an on-demand read) found, with where it sits. */
export type LedgerSighting = FirstSightingFacts &
  Readonly<{
    /** The location: opaque, only compared. */
    locationKey: string
    /** The Google account the location belongs to (Organization + connection + account). */
    accountKey: string
  }>

export type LedgerSummary = Readonly<{
  pending: number
  missed24h: number
  late24h: number
  /** Polled Reviews of the last day that Google published late: not new arrivals. */
  latePublished24h: number
  locationsSuspect: number
  accountsDark: number
}>

/**
 * Judge the first sightings polling found, at `now`. The alert counts cover
 * the last 24 hours; location and account health cover the whole health window,
 * so `sightings` holds the health window's rows (the caller bounds the read).
 * Pushes that covered a Review are healthy by construction and are not rows
 * here; the caller counts them.
 */
export function summarizeLedger(
  sightings: readonly LedgerSighting[],
  now: Date,
): LedgerSummary {
  const alertSince = now.getTime() - PUSH_ALERT_WINDOW_MS
  let pending = 0
  let missed24h = 0
  let late24h = 0
  let latePublished24h = 0
  const missedByLocation = new Map<string, number>()
  const missedByAccount = new Map<string, number>()
  for (const sighting of sightings) {
    const coverage = classifyFirstSighting(sighting, now)
    const recent = sighting.firstSeenAt.getTime() > alertSince
    if (recent && coverage.pending) pending += 1
    if (recent && coverage.late) late24h += 1
    if (recent && coverage.missed) missed24h += 1
    if (recent && publishedLate(sighting)) latePublished24h += 1
    if (coverage.missed) {
      missedByLocation.set(
        sighting.locationKey,
        (missedByLocation.get(sighting.locationKey) ?? 0) + 1,
      )
      missedByAccount.set(
        sighting.accountKey,
        (missedByAccount.get(sighting.accountKey) ?? 0) + 1,
      )
    }
  }
  return {
    pending,
    missed24h,
    late24h,
    latePublished24h,
    locationsSuspect: [...missedByLocation.values()].filter(
      (missed) => locationPushHealth(missed) === 'suspect',
    ).length,
    accountsDark: [...missedByAccount.values()].filter(
      (missed) => accountPushHealth(missed) === 'dark',
    ).length,
  }
}
