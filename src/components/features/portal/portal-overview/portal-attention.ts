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

export type PortalIssue = Readonly<{
  code: PortalIssueCode
  title: string
  detail: string
  fix: PortalIssueFix
}>

export type PortalAttention =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'archived' }>
  | Readonly<{ kind: 'disabled' }>
  | Readonly<{ kind: 'draft' }>
  | Readonly<{ kind: 'pending'; count: number }>
  | Readonly<{ kind: 'issues'; issues: readonly PortalIssue[] }>

const ISSUES: Readonly<Record<PortalIssueCode, Omit<PortalIssue, 'code'>>> = {
  property_unavailable: {
    title: 'The property is unavailable',
    detail: 'Guests cannot open this portal while its property is paused or removed.',
    fix: 'page',
  },
  no_live_version: {
    title: 'No live version',
    detail: 'Guests have nothing to see yet. Review and publish the portal again.',
    fix: 'page',
  },
  no_code: {
    title: 'No working code',
    detail: 'Guests cannot reach this portal. Make a code on the Share tab.',
    fix: 'share',
  },
  no_responsible: {
    title: 'No one is responsible',
    detail: 'Nobody gets this portal’s notices. Choose a manager.',
    fix: 'responsible',
  },
  google_refreshing: {
    title: 'The Google link is being refreshed',
    detail:
      'Guests are still sent to Google once it is ready. This usually clears itself.',
    fix: 'google',
  },
  google_unavailable: {
    title: 'The Google link is unavailable',
    detail: 'Guests cannot be sent to Google. Check the property’s Google connection.',
    fix: 'google',
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
  // An older code still works; the Share tab alone says its scans are left out
  // of scan-based goals, so the overview does not turn it into an issue.
  if (!input.token.hasActiveToken) codes.push('no_code')
  if (input.responsibleManagerUserIds.length === 0) codes.push('no_responsible')
  if (reason === 'google_destination_awaiting_refresh') codes.push('google_refreshing')
  if (reason === 'google_destination_unavailable') codes.push('google_unavailable')
  return codes.map(issue)
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
      if (input.pendingChangeCount > 0) {
        return { kind: 'pending', count: input.pendingChangeCount }
      }
      return { kind: 'none' }
    }
  }
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

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
    case 'issues':
      return plural(attention.issues.length, 'issue', 'issues')
  }
}

const RANKS: Readonly<Record<PortalAttention['kind'], number>> = {
  archived: 0,
  none: 1,
  disabled: 2,
  draft: 3,
  pending: 4,
  issues: 5,
}

/** Higher needs a manager sooner. Archived is last: it is finished, not waiting. */
export function attentionRank(attention: PortalAttention): number {
  return RANKS[attention.kind]
}

/** Whether the "needs attention" filter keeps the Portal. */
export function needsAttention(attention: PortalAttention): boolean {
  return attention.kind !== 'none' && attention.kind !== 'archived'
}
