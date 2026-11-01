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
 * A Review Google dates this long before RepKey first saw it was not a new
 * arrival. Polling lists a Property about every six hours, so a Review that old
 * was not in Google's listing until now: Google published it late. Google does
 * not reliably announce those, so a missing push for one says nothing about the
 * fast path (ADR 0055, note 2026-11-01).
 */
export const LATE_PUBLISHED_AFTER_MS = 24 * 60 * 60 * 1000

/** The window a location's or an account's health is judged over. */
export const PUSH_HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** The window the alerts count over. */
export const PUSH_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * A syncable Property is reconciliation-overdue past this age. The discovery
 * sweep guarantees a completed reconciliation about every six hours (ADR 0055
 * decision 5, plus up to one sweep of latency and the sync itself); two hours
 * of slack on top keeps one slow sweep from paging.
 */
export const RECONCILIATION_OVERDUE_AFTER_MS = 8 * 60 * 60 * 1000

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
  return (
    sighting.sourceCreatedAt !== null &&
    sighting.firstSeenAt.getTime() - sighting.sourceCreatedAt.getTime() >
      LATE_PUBLISHED_AFTER_MS
  )
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
