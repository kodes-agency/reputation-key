// Monthly portal goal — how ready each Portal is, and what is quiet about it
// (ADR 0068 decision 5).
//
// Before a Property's recommended number exists, each Portal shows three
// steps: it is live, its code is made (a published QR or NFC marker, so its
// scans count) and a first scan has arrived since that code was made. Once a
// Portal counts, one quiet fact may be said about it: it has had no scans for
// long enough that its own usual would have brought 5, or its code has been
// out 14 days with no scan at all. Facts, never a verdict about a person.
//
// Days are Property-local calendar days as `YYYY-MM-DD`, decided by the
// server. Pure.

/** A quiet spell is worth a word once the Portal's usual would have brought this many. */
const QUIET_EXPECTED_SCANS = 5
/** A code is old enough to have been scanned after this many local days. */
const CODE_SETTLE_DAYS = 14

const DAYS_PER_WEEK = 7

export type PortalReadiness = Readonly<{
  live: boolean
  /** Its code is made and its QR or NFC marker published. */
  codeMade: boolean
  /** A scan has arrived since that code was made. */
  firstScan: boolean
}>

export type PortalReadinessInput = Readonly<{
  /** When its current live run began; null when it is not live. */
  liveSince: Date | null
  codeIssuedAt: Date | null
  /** The code has a published access marker. */
  codeReady: boolean
  /** Its last scan since the code was made; null when none. */
  lastScanAt: Date | null
}>

export function portalReadiness(input: PortalReadinessInput): PortalReadiness {
  return {
    live: input.liveSince !== null,
    codeMade: input.codeReady && input.codeIssuedAt !== null,
    firstScan: input.lastScanAt !== null,
  }
}

export type PortalQuietFact =
  | Readonly<{ kind: 'no_scans_since'; since: string; usualPerWeek: number }>
  | Readonly<{ kind: 'no_scan_since_code'; days: number }>

export type PortalQuietInput = Readonly<{
  /** The Property's local day today. */
  today: string
  readiness: PortalReadiness
  /** Live with 14 live days in the basis, so it is in the rate. */
  established: boolean
  /** Its live days in the basis. */
  liveDays: number
  /** Its scans on those live days. */
  scans: number
  /** The local day its code was made; null when it has none. */
  codeMadeOn: string | null
  /** The local day of its last scan since that code; null when none. */
  lastScanOn: string | null
}>

const MS_PER_DAY = 86_400_000

/** A local day as a count of days, so two of them subtract. */
function dayNumber(localDay: string): number {
  const [year = 0, month = 1, day = 1] = localDay.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

/** Whole local days from `from` to `to`: 0 for the same day. */
const localDaysFrom = (from: string, to: string): number =>
  dayNumber(to) - dayNumber(from)

/** round(numerator / denominator), half up, for non-negative integers. */
const roundHalfUp = (numerator: number, denominator: number): number =>
  Math.floor((2 * numerator + denominator) / (2 * denominator))

function noScanSinceCode(input: PortalQuietInput): PortalQuietFact | null {
  if (!input.readiness.live || input.codeMadeOn === null || input.lastScanOn !== null) {
    return null
  }
  const days = localDaysFrom(input.codeMadeOn, input.today)
  return days >= CODE_SETTLE_DAYS ? { kind: 'no_scan_since_code', days } : null
}

function noScansSince(input: PortalQuietInput): PortalQuietFact | null {
  if (!input.established || input.lastScanOn === null || input.scans <= 0) return null
  // The whole days after the last scan's day, today (still going) left out.
  const silentDays = localDaysFrom(input.lastScanOn, input.today) - 1
  // silentDays × scans / liveDays ≥ 5, compared whole.
  if (silentDays * input.scans < QUIET_EXPECTED_SCANS * input.liveDays) return null
  return {
    kind: 'no_scans_since',
    since: input.lastScanOn,
    usualPerWeek: roundHalfUp(DAYS_PER_WEEK * input.scans, input.liveDays),
  }
}

/** The one quiet fact worth saying about a Portal, or null. */
export function portalQuietFact(input: PortalQuietInput): PortalQuietFact | null {
  return noScanSinceCode(input) ?? noScansSince(input)
}
