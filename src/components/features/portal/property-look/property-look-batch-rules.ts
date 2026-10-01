// What the batch "Review & publish" decides without a screen: what can be done
// with each live portal (from its own review read, the same one the review page
// asks), how that reads, and how the outcome of a publish reads. Pure, so the
// wording and the choices are pinned by tests.
//
// The rules mirror the server's: a portal with nothing to publish is not asked
// the gates, a blocked check is what the publish use case would refuse on, and
// a viewer who may not publish sees no tick, so the batch never offers what
// `publishPortalsChanges` would refuse.

import type {
  PortalReview,
  PublishPortalsChangesResult,
  ReviewCheck,
} from '#/contexts/portal/application/public-api'
import { GUEST_LOCALE_METADATA } from '#/shared/domain/guest-locale'

/** One request publishes at most this many portals (`MAX_PORTALS_PER_PUBLISH_BATCH`, pinned by a test). */
export const PUBLISH_BATCH_SIZE = 50

/** What the batch reads of a portal's review. */
export type BatchReviewFacts = Pick<
  PortalReview,
  | 'action'
  | 'nothingToPublish'
  | 'canPublish'
  | 'publishesAsVersion'
  | 'changes'
  | 'changesMayBeIncomplete'
  | 'checks'
>

export type BatchEntry =
  | Readonly<{
      kind: 'ready'
      version: number
      changeCount: number
      changesMayBeIncomplete: boolean
    }>
  | Readonly<{ kind: 'nothing' }>
  | Readonly<{ kind: 'blocked'; reasons: readonly string[] }>
  /** The viewer may not publish it (a role or a switched-off capability). */
  | Readonly<{ kind: 'not_allowed' }>
  /** It stopped being live since the page was loaded. */
  | Readonly<{ kind: 'not_live' }>
  | Readonly<{ kind: 'unreadable' }>

type BlockedCode = ReviewCheck['code']

const FIXED_REASONS: Readonly<Partial<Record<BlockedCode, string>>> = {
  property_available: 'The Property is not active',
  google_destination: 'No verified Google review address',
  responsible_manager: 'Nobody is responsible for it',
  public_address: 'No public address',
  time_zone: 'Its time zone is not valid',
}

const LANGUAGE_REASONS: Readonly<Partial<Record<BlockedCode, string>>> = {
  primary_text: 'Text missing in',
  language_packs: 'No guest text for',
}

function languageList(locales: readonly string[]): string {
  const names = locales.map(
    (locale) =>
      GUEST_LOCALE_METADATA[locale as keyof typeof GUEST_LOCALE_METADATA]?.englishName ??
      locale,
  )
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** One line per blocked check, a check that concerns several languages named once. */
export function blockedReasons(checks: readonly ReviewCheck[]): readonly string[] {
  const order: BlockedCode[] = []
  const locales = new Map<BlockedCode, string[]>()
  for (const found of checks) {
    if (found.status !== 'blocked') continue
    if (!locales.has(found.code)) {
      order.push(found.code)
      locales.set(found.code, [])
    }
    if (found.locale !== null) locales.get(found.code)?.push(found.locale)
  }
  return order.map((code) => {
    const lead = LANGUAGE_REASONS[code]
    const named = locales.get(code) ?? []
    if (lead === undefined) return FIXED_REASONS[code] ?? 'Needs attention'
    return named.length === 0
      ? lead.replace(/ (in|for)$/u, '')
      : `${lead} ${languageList(named)}`
  })
}

const NAMEABLE = new Set([
  'edit',
  'unrecorded',
  'earlier_design',
  'google_destination_moved',
])

/** What the batch can do with a portal whose review was read (`null`: it could not be). */
export function batchEntryOf(review: BatchReviewFacts | null): BatchEntry {
  if (review === null) return { kind: 'unreadable' }
  if (review.action !== 'publish_changes') return { kind: 'not_live' }
  if (review.nothingToPublish) return { kind: 'nothing' }
  if (review.canPublish) {
    return {
      kind: 'ready',
      version: review.publishesAsVersion,
      changeCount: review.changes.filter((change) => NAMEABLE.has(change.type)).length,
      changesMayBeIncomplete: review.changesMayBeIncomplete,
    }
  }
  const reasons = blockedReasons(review.checks)
  return reasons.length > 0 ? { kind: 'blocked', reasons } : { kind: 'not_allowed' }
}

export function describeEntry(entry: BatchEntry): string {
  switch (entry.kind) {
    case 'ready': {
      const head = `Publishes as version ${entry.version}`
      if (entry.changeCount === 0) return head
      const noun = entry.changeCount === 1 ? 'change' : 'changes'
      const count = entry.changesMayBeIncomplete
        ? `at least ${entry.changeCount} ${noun}`
        : `${entry.changeCount} ${noun}`
      return `${head} · ${count}`
    }
    case 'nothing':
      return 'Nothing new to publish'
    case 'blocked':
      return `Cannot be published · ${entry.reasons.join('; ')}`
    case 'not_allowed':
      return 'You cannot publish this portal'
    case 'not_live':
      return 'No longer live'
    case 'unreadable':
      return 'Could not be checked'
  }
}

export type BatchTotals = Readonly<{
  ready: number
  nothing: number
  blocked: number
  /** Not allowed, no longer live, or unreadable: nothing the batch can do. */
  other: number
}>

export function totalsOf(entries: readonly BatchEntry[]): BatchTotals {
  const count = (kind: BatchEntry['kind']) =>
    entries.filter((entry) => entry.kind === kind).length
  const ready = count('ready')
  const nothing = count('nothing')
  const blocked = count('blocked')
  return { ready, nothing, blocked, other: entries.length - ready - nothing - blocked }
}

export function describeBatchSummary(totals: BatchTotals): string {
  const parts = [
    totals.ready > 0 ? `${totals.ready} to publish` : null,
    totals.nothing > 0 ? `${totals.nothing} with nothing new` : null,
    totals.blocked > 0 ? `${totals.blocked} cannot be published` : null,
    totals.other > 0 ? `${totals.other} not available` : null,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? 'No live portals' : parts.join(' · ')
}

/** The portals to publish: every ready one the manager did not leave out, in the order shown. */
export function idsToPublish(
  rows: ReadonlyArray<Readonly<{ portalId: string; entry: BatchEntry }>>,
  leftOut: ReadonlySet<string>,
): readonly string[] {
  return rows
    .filter((row) => row.entry.kind === 'ready' && !leftOut.has(row.portalId))
    .map((row) => row.portalId)
}

type Outcome = PublishPortalsChangesResult[number]

export function describeOutcome(outcome: Outcome): Readonly<{
  text: string
  tone: 'ok' | 'quiet' | 'warn'
}> {
  switch (outcome.outcome) {
    case 'published':
      return { text: `Published as version ${outcome.version}`, tone: 'ok' }
    case 'unchanged':
      return { text: 'Already up to date', tone: 'quiet' }
    case 'failed':
      return { text: `Not published · ${outcome.message}`, tone: 'warn' }
  }
}

export function describeOutcomesSummary(outcomes: readonly Outcome[]): string {
  const count = (kind: Outcome['outcome']) =>
    outcomes.filter((outcome) => outcome.outcome === kind).length
  const parts = [
    [count('published'), 'published'],
    [count('unchanged'), 'already up to date'],
    [count('failed'), 'not published'],
  ] as const
  return parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(' · ')
}
