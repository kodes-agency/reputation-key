// Portal context — the merged History read model (round 4, slice 35a).
//
// One timeline per Portal, merged from four independently ordered sources:
// the page's creation, its publication activations, its health intervals and
// its public-address (code) tokens. Each source is read newest first with its
// own limit and this module merges them, so the merge must be exact: a total
// order (time, then key) and a cursor that every source can turn into its own
// "strictly before" condition. Everything here is pure; the SQL lives in
// infrastructure and only consumes the bound computed below.

import type { PortalHealthReason, PortalHealthStatus } from './portal-health'

export const PORTAL_HISTORY_CATEGORIES = ['publishing', 'codes', 'health'] as const
export type PortalHistoryCategory = (typeof PORTAL_HISTORY_CATEGORIES)[number]
export type PortalHistoryFilter = 'all' | PortalHistoryCategory

export const historyCategoriesFor = (
  filter: PortalHistoryFilter,
): readonly PortalHistoryCategory[] =>
  filter === 'all' ? PORTAL_HISTORY_CATEGORIES : [filter]

/**
 * Key prefixes, one per source. They are prefix-free (each ends in ":" and
 * none starts another), so comparing a source prefix with a cursor key decides
 * every same-instant tie without looking at ids.
 */
export const HISTORY_KEY_PREFIX = {
  codeIssued: 'code-issued:',
  codeRevoked: 'code-revoked:',
  created: 'created:',
  health: 'health:',
  publication: 'publication:',
} as const

export type PortalHistoryDetail =
  | Readonly<{ kind: 'portal_created' }>
  | Readonly<{ kind: 'version_published'; version: number }>
  | Readonly<{ kind: 'version_restored'; version: number }>
  | Readonly<{
      kind: 'health_changed'
      status: PortalHealthStatus
      reason: PortalHealthReason
    }>
  | Readonly<{ kind: 'code_issued'; version: number }>
  | Readonly<{
      kind: 'code_replaced'
      version: number
      /** When the replaced address stops working; null once it was revoked. */
      previousCodesWorkUntil: string | null
    }>
  | Readonly<{ kind: 'codes_revoked'; reason: string | null }>

export type PortalHistoryRecord = Readonly<{
  key: string
  at: Date
  category: PortalHistoryCategory
  /** The user who did it. Null for the system, or when nothing recorded who. */
  actorUserId: string | null
  detail: PortalHistoryDetail
}>

export type HistoryPosition = Readonly<{ at: Date; key: string }>

/** Newest first; a tie on the instant is broken by key, highest first. */
export function compareHistoryDescending(
  a: Pick<PortalHistoryRecord, 'at' | 'key'>,
  b: Pick<PortalHistoryRecord, 'at' | 'key'>,
): number {
  const byTime = b.at.getTime() - a.at.getTime()
  if (byTime !== 0) return byTime
  if (a.key === b.key) return 0
  return a.key < b.key ? 1 : -1
}

export function pageHistory(
  records: readonly PortalHistoryRecord[],
  limit: number,
): Readonly<{ records: readonly PortalHistoryRecord[]; next: HistoryPosition | null }> {
  const ordered = [...records].sort(compareHistoryDescending)
  const visible = ordered.slice(0, limit)
  const last = visible.at(-1)
  return {
    records: visible,
    next: ordered.length > limit && last ? { at: last.at, key: last.key } : null,
  }
}

// ── cursor ─────────────────────────────────────────────────────────

const CURSOR_PATTERN = /^(\d{1,15})\|([a-z-]{1,20}:[0-9A-Za-z-]{1,64})$/
const KEY_PREFIXES: readonly string[] = Object.values(HISTORY_KEY_PREFIX)

export const encodeHistoryCursor = (position: HistoryPosition): string =>
  `${position.at.getTime()}|${position.key}`

/** Null for anything this module did not produce, so a bad cursor starts over. */
export function decodeHistoryCursor(value: string): HistoryPosition | null {
  const match = CURSOR_PATTERN.exec(value)
  if (!match) return null
  const [, millis, key] = match
  if (millis === undefined || key === undefined) return null
  if (!KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return null
  const at = new Date(Number(millis))
  return Number.isNaN(at.getTime()) ? null : { at, key }
}

// ── the bound a source applies ─────────────────────────────────────

/**
 * A source row is before the cursor when `at < bound.at`, or when it shares the
 * instant, `inclusive` is set and (when `afterId` is given) its id sorts
 * strictly below `afterId`. Text compared in the "C" collation, like the keys.
 */
export type HistoryBound = Readonly<{
  at: Date
  inclusive: boolean
  afterId: string | null
}>

export function historyBoundFor(
  prefix: string,
  position: HistoryPosition | null,
  idless = false,
): HistoryBound | null {
  if (position === null) return null
  if (position.key.startsWith(prefix)) {
    return idless
      ? { at: position.at, inclusive: false, afterId: null }
      : { at: position.at, inclusive: true, afterId: position.key.slice(prefix.length) }
  }
  return { at: position.at, inclusive: prefix < position.key, afterId: null }
}

// ── address events ────────────────────────────────────────────────

type IssuedToken = Readonly<{ version: number; issuedAt: Date }>
type PredecessorToken = Readonly<{ revokedAt: Date | null; gracePeriodEnds: Date | null }>

/**
 * An address issued while the one before it was still live is a replacement
 * (rotation). Issue is only allowed once the last address is revoked, so an
 * address issued after that revocation is a fresh issue. A later "turn off
 * all codes" nulls the old address's grace end, which is why the decision
 * compares the two instants rather than reading the grace end.
 */
export function classifyCodeIssuance(
  token: IssuedToken,
  predecessor: PredecessorToken | null,
): Extract<PortalHistoryDetail, { kind: 'code_issued' | 'code_replaced' }> {
  const predecessorWasLive =
    predecessor !== null &&
    (predecessor.revokedAt === null || predecessor.revokedAt > token.issuedAt)
  if (!predecessorWasLive) return { kind: 'code_issued', version: token.version }
  return {
    kind: 'code_replaced',
    version: token.version,
    previousCodesWorkUntil: predecessor.gracePeriodEnds?.toISOString() ?? null,
  }
}
