// What, if anything, a Portal needs from its manager, for the Portals overview.
//
// Status is not the point of the overview (round-4 owner decision), so this
// answers one question per Portal: is there something to say, and what is the
// single quiet line for it? A Portal that is live and needs nothing gets no
// line at all. Pure, so the rules are readable, and testable, apart from the
// table that shows them.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'

export type PortalAttentionInput = Pick<
  PortalOverviewRow,
  | 'publicationState'
  | 'health'
  | 'pendingChangeCount'
  | 'token'
  | 'responsibleManagerUserIds'
>

export type PortalIssueCode =
  | 'property_unavailable'
  | 'no_live_version'
  | 'no_code'
  | 'no_responsible'
  | 'google_refreshing'
  | 'google_unavailable'

/** Where a manager goes to put an issue right. */
export type PortalIssueFix = 'share' | 'responsible' | 'google' | 'page'

/**
 * `blocking`: guests cannot use the Portal as it is (no working code, no live
 * version, the Property unavailable, no way to send them to Google). `notice`:
 * guests are served, but something should be put right.
 */
export type PortalIssueSeverity = 'blocking' | 'notice'

export type PortalIssue = Readonly<{
  code: PortalIssueCode
  /** What the issue is, as the popover heads it. */
  title: string
  /** The same in a few words, for the row's line when it is the only issue. */
  short: string
  detail: string
  fix: PortalIssueFix
  severity: PortalIssueSeverity
}>

export type PortalAttention =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'archived' }>
  | Readonly<{ kind: 'disabled' }>
  | Readonly<{ kind: 'draft' }>
  | Readonly<{ kind: 'pending'; count: number }>
  | Readonly<{ kind: 'older_code' }>
  | Readonly<{ kind: 'issues'; issues: readonly PortalIssue[] }>

const ISSUES: Readonly<Record<PortalIssueCode, Omit<PortalIssue, 'code'>>> = {
  property_unavailable: {
    title: 'The property is unavailable',
    short: 'Property unavailable',
    detail: 'Guests cannot open this portal while its property is paused or removed.',
    fix: 'page',
    severity: 'blocking',
  },
  no_live_version: {
    title: 'No live version',
    short: 'No live version',
    detail: 'Guests have nothing to see yet. Review and publish the portal again.',
    fix: 'page',
    severity: 'blocking',
  },
  no_code: {
    title: 'No working code',
    short: 'No working code',
    detail: 'Guests cannot reach this portal. Make a code on the Share tab.',
    fix: 'share',
    severity: 'blocking',
  },
  no_responsible: {
    title: 'No one is responsible',
    short: 'No one responsible',
    detail: 'Nobody gets this portal’s notices. Choose a manager.',
    fix: 'responsible',
    severity: 'notice',
  },
  google_refreshing: {
    title: 'The Google link is being refreshed',
    short: 'Google link updating',
    detail:
      'Guests are still sent to Google once it is ready. This usually clears itself.',
    fix: 'google',
    severity: 'notice',
  },
  google_unavailable: {
    title: 'The Google link is unavailable',
    short: 'Google link unavailable',
    detail: 'Guests cannot be sent to Google. Check the property’s Google connection.',
    fix: 'google',
    severity: 'blocking',
  },
}

const issue = (code: PortalIssueCode): PortalIssue => ({ code, ...ISSUES[code] })

/**
 * The issues of a live Portal, most blocking first, each once. Health names only
 * the first thing that fails, so the facts the row carries (the code, the
 * managers) are read on their own as well, and a problem both report counts once.
 */
function liveIssues(input: PortalAttentionInput): readonly PortalIssue[] {
  const reason = input.health?.reason
  const codes: PortalIssueCode[] = []
  if (reason === 'property_unavailable') codes.push('property_unavailable')
  if (reason === 'publication_snapshot_unavailable') codes.push('no_live_version')
  // An older code still works, so it is not an issue; `olderCode` below gives it
  // its own line, which links to Share, where the code is replaced.
  if (!input.token.hasActiveToken) codes.push('no_code')
  if (input.responsibleManagerUserIds.length === 0) codes.push('no_responsible')
  if (reason === 'google_destination_awaiting_refresh') codes.push('google_refreshing')
  if (reason === 'google_destination_unavailable') codes.push('google_unavailable')
  return codes.map(issue)
}

/** A live code that predates access artifacts: guests scan it, but scans are not counted. */
const hasOlderCode = (input: Pick<PortalAttentionInput, 'token'>): boolean =>
  input.token.hasActiveToken && !input.token.qualifiedScanReady

/**
 * Whether a live Portal's scans are not counted, so that no figure of its own is
 * honest: its code predates scan counting. A zero would be a number nobody counted.
 */
export function hasUncountedScans(
  input: Pick<PortalAttentionInput, 'publicationState' | 'token'>,
): boolean {
  return input.publicationState === 'published' && hasOlderCode(input)
}

/** The Portals whose scans are not counted, for the note under the results strip. */
export function uncountedScanPortals<
  T extends Pick<PortalOverviewRow, 'portalId' | 'publicationState' | 'token'>,
>(rows: readonly T[]): readonly T[] {
  return rows.filter(hasUncountedScans)
}

export function portalAttention(input: PortalAttentionInput): PortalAttention {
  switch (input.publicationState) {
    case 'archived':
      return { kind: 'archived' }
    case 'draft':
      return { kind: 'draft' }
    case 'disabled':
      return { kind: 'disabled' }
    case 'published': {
      const issues = liveIssues(input)
      if (issues.length > 0) return { kind: 'issues', issues }
      if (hasOlderCode(input)) return { kind: 'older_code' }
      if (input.pendingChangeCount > 0) {
        return { kind: 'pending', count: input.pendingChangeCount }
      }
      return { kind: 'none' }
    }
  }
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

/** What an older code costs, and what puts it right: replacing means reprinting. */
const OLDER_CODE_LINE = 'Scans not counted · replace the code (needs reprinting)'

/** The one quiet line, or null when there is nothing to say. */
export function attentionLine(attention: PortalAttention): string | null {
  switch (attention.kind) {
    case 'none':
      return null
    case 'archived':
      return 'Archived'
    case 'disabled':
      return 'Disabled · guests cannot open it'
    case 'draft':
      return 'Draft · not published'
    case 'pending':
      return `${plural(attention.count, 'change', 'changes')} not live`
    case 'older_code':
      return OLDER_CODE_LINE
    case 'issues':
      return attention.issues.length === 1
        ? (attention.issues[0]?.short ?? '1 issue')
        : plural(attention.issues.length, 'issue', 'issues')
  }
}

const RANKS: Readonly<Record<PortalAttention['kind'], number>> = {
  archived: 0,
  none: 1,
  disabled: 2,
  draft: 3,
  pending: 4,
  older_code: 5,
  issues: 6,
}

/** Issues that stop guests come before those that do not (the Overview's chip opens this order). */
const BLOCKING_RANK = RANKS.issues + 1

/** Higher needs a manager sooner. Archived is last: it is finished, not waiting. */
export function attentionRank(attention: PortalAttention): number {
  return isBlocked(attention) ? BLOCKING_RANK : RANKS[attention.kind]
}

/**
 * Whether guests cannot use the Portal as it is: a live Portal with a blocking
 * issue. Draft, disabled and archived Portals are not "broken", they are set
 * aside; this is the one question the Overview asks of the list.
 */
export function isBlocked(attention: PortalAttention): boolean {
  return (
    attention.kind === 'issues' &&
    attention.issues.some((issue) => issue.severity === 'blocking')
  )
}

/** The worse of a Portal's issues: red when any of them stops guests, amber when none does. */
export function issuesTone(issues: readonly PortalIssue[]): PortalIssueSeverity {
  return issues.some((issue) => issue.severity === 'blocking') ? 'blocking' : 'notice'
}

/** How many of the Portals guests cannot use (the Overview's one portal chip). */
export function countBlockedPortals(rows: readonly PortalAttentionInput[]): number {
  return rows.filter((row) => isBlocked(portalAttention(row))).length
}

/** Whether the "needs attention" filter keeps the Portal. */
export function needsAttention(attention: PortalAttention): boolean {
  return attention.kind !== 'none' && attention.kind !== 'archived'
}

/**
 * Whether the overview's toolbar offers its "Needs attention" toggle: while a
 * Portal needs attention, and while the filter is on, so it can be turned off
 * again. With nothing to keep it is left out.
 */
export function offersAttentionFilter(
  needingAttention: number,
  search: Readonly<{ show?: 'attention' }>,
): boolean {
  return needingAttention > 0 || search.show === 'attention'
}
