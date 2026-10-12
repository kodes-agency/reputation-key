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
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  joinPhrases,
  nativeLanguage,
  phraseText,
} from '../portal-history/portal-history-phrase'
import {
  describeReviewCheck,
  reviewCheckContext,
} from '../portal-review/portal-review-checks'
import {
  changeMixOf,
  describeMix,
  describeOthers,
  hasOtherEdits,
  type ChangeMix,
} from './property-look-batch-changes'

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
  | 'languages'
>

export type BatchEntry =
  | Readonly<{
      kind: 'ready'
      version: number
      /** What the publish carries: this page's look edits, and everything else saved. */
      mix: ChangeMix
      changesMayBeIncomplete: boolean
    }>
  | Readonly<{ kind: 'nothing' }>
  | Readonly<{ kind: 'blocked'; reasons: readonly string[] }>
  /** The viewer may not publish it (a role or a switched-off capability). */
  | Readonly<{ kind: 'not_allowed' }>
  /** It stopped being live since the page was loaded. */
  | Readonly<{ kind: 'not_live' }>
  | Readonly<{ kind: 'unreadable' }>

/** One blocked check as a line: the title the review page gives it, without its closing full stop. */
const briefOf = (check: ReviewCheck, languages: PortalReview['languages']): string =>
  phraseText(
    describeReviewCheck(check, reviewCheckContext(languages, check.locale)).title,
  ).replace(/\.$/u, '')

/** "Deutsch and Français have no guest wording yet": a language-by-language check said once. */
function languagePacksBrief(locales: readonly GuestLocale[]): string {
  const names = joinPhrases(locales.map((locale) => [nativeLanguage(locale)]))
  return `${phraseText(names)} ${locales.length === 1 ? 'has' : 'have'} no guest wording yet`
}

/**
 * One line per blocked check, worded as the Review & publish page words it
 * (`describeReviewCheck`), so a line here and the page its "Open" link leads to
 * read alike. A check that concerns several languages is said once.
 */
export function blockedReasons(
  checks: readonly ReviewCheck[],
  languages: PortalReview['languages'],
): readonly string[] {
  const order: ReviewCheck['code'][] = []
  const groups = new Map<ReviewCheck['code'], ReviewCheck[]>()
  for (const found of checks) {
    if (found.status !== 'blocked') continue
    const group = groups.get(found.code)
    if (group === undefined) {
      order.push(found.code)
      groups.set(found.code, [found])
    } else {
      group.push(found)
    }
  }
  return order.map((code) => {
    const group = groups.get(code) ?? []
    const locales = group.flatMap((found) =>
      found.locale === null ? [] : [found.locale],
    )
    if (code === 'language_packs' && locales.length === group.length) {
      return languagePacksBrief(locales)
    }
    return group.map((found) => briefOf(found, languages)).join(', ')
  })
}

/** What the batch can do with a portal whose review was read (`null`: it could not be). */
export function batchEntryOf(review: BatchReviewFacts | null): BatchEntry {
  if (review === null) return { kind: 'unreadable' }
  if (review.action !== 'publish_changes') return { kind: 'not_live' }
  if (review.nothingToPublish) return { kind: 'nothing' }
  if (review.canPublish) {
    return {
      kind: 'ready',
      version: review.publishesAsVersion,
      mix: changeMixOf(review.changes),
      changesMayBeIncomplete: review.changesMayBeIncomplete,
    }
  }
  const reasons = blockedReasons(review.checks, review.languages)
  return reasons.length > 0 ? { kind: 'blocked', reasons } : { kind: 'not_allowed' }
}

export function describeEntry(entry: BatchEntry): string {
  switch (entry.kind) {
    case 'ready': {
      const head = `Publishes as version ${entry.version}`
      const carries = describeMix(entry.mix, entry.changesMayBeIncomplete)
      return carries === null ? head : `${head} · ${carries}`
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

/**
 * The line of a ready portal that is not ticked. One that is unticked because it
 * carries other draft edits says so, and that ticking it publishes them too.
 */
export function describeLeftOut(entry: BatchEntry): string {
  if (entry.kind !== 'ready' || !startsLeftOut(entry)) {
    return 'Left out · stays as it is for guests'
  }
  const others = describeOthers(entry.mix, entry.changesMayBeIncomplete)
  return `Left out · also has ${others ?? 'other draft edits'} · ticking it publishes them too`
}

export type BatchTotals = Readonly<{
  ready: number
  /** Of the ready ones, those that also carry other draft edits and start unticked. */
  withOtherEdits: number
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
  return {
    ready,
    withOtherEdits: entries.filter(startsLeftOut).length,
    nothing,
    blocked,
    other: entries.length - ready - nothing - blocked,
  }
}

/**
 * A ready portal that also carries other draft edits starts unticked: ticking it
 * is the manager saying those edits may go live too.
 */
export function startsLeftOut(entry: BatchEntry): boolean {
  return entry.kind === 'ready' && hasOtherEdits(entry.mix)
}

export function describeBatchSummary(totals: BatchTotals): string {
  // The ready portals that start ticked; the others wait for the manager.
  const ticked = totals.ready - totals.withOtherEdits
  const parts = [
    ticked > 0 ? `${ticked} to publish` : null,
    totals.withOtherEdits > 0
      ? `${totals.withOtherEdits} with other draft edits, unticked`
      : null,
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

/** A portal that was sent but has no outcome: its request failed (it may be live) or was never reached. */
export function describeUnanswered(kind: 'unconfirmed' | 'untried'): Readonly<{
  text: string
  tone: 'warn'
}> {
  return kind === 'unconfirmed'
    ? {
        text: 'Not confirmed · may have been published; trying again is safe',
        tone: 'warn',
      }
    : { text: 'Not tried · stopped before it', tone: 'warn' }
}

/**
 * The alert for a request that failed as a whole. It does not say the portals of
 * that request were untouched: some of them may be live. Trying again is safe
 * because a portal already up to date answers "unchanged".
 */
export function describeStop(
  reason: string,
  counts: Readonly<{ untried: number }>,
): string {
  const sentence = /[.!?]$/u.test(reason) ? reason : `${reason}.`
  const rest = counts.untried > 0 ? ' The others were not sent.' : ''
  return `Publishing stopped: ${sentence} The portals in that request may or may not have been published; trying again is safe.${rest}`
}
