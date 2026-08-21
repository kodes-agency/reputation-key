// Every branch behind the Share tab lives here so the components stay flat
// descriptions of what is on screen: which notices show, what the active-link
// summary reads, and what the screen reader is told.

import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import type { PortalShareMutations } from './portal-share-types'

// Fixed locale + UTC so the server and client render the same string (same
// reason as property-dashboard-review-row.tsx): a mismatch hydrates as an error.
const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

function formatTimestamp(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : timestampFormatter.format(date)
}

/** `version 3, issued Jan 4, 2026`, dropping whichever part the token lacks. */
function formatActiveLinkDetail(tokenStatus: PortalTokenStatus): string {
  const issuedAtLabel = formatTimestamp(tokenStatus.issuedAt)
  return [
    tokenStatus.version === null ? null : `version ${tokenStatus.version}`,
    issuedAtLabel === null ? null : `issued ${issuedAtLabel}`,
  ]
    .filter((part) => part !== null)
    .join(', ')
}

export type PortalShareView = Readonly<{
  showViewOnlyNotice: boolean
  showRevokedNotice: boolean
  showIssueForm: boolean
  showActiveLinkNotice: boolean
  showActions: boolean
  activeLinkDetail: string
  graceLabel: string | null
}>

type ViewInput = Readonly<{
  canManage: boolean
  revoked: boolean
  publicUrl: string | null
  tokenStatus: PortalTokenStatus
}>

export function derivePortalShareView(input: ViewInput): PortalShareView {
  const { canManage, revoked, publicUrl, tokenStatus } = input

  // The raw URL only exists in memory for the render that issued or rotated it,
  // so `publicUrl` cannot answer "is a link live?" after a reload — deriving the
  // rotate/revoke affordances from it left a leaked QR permanently unrevocable.
  // `tokenStatus` (C2, returned by getPortal) is the durable answer; in-session
  // issue/revoke outcomes run ahead of it until the detail query refetches, so
  // they take precedence.
  const hasActiveToken = !revoked && (publicUrl !== null || tokenStatus.hasActiveToken)
  const hasUrl = publicUrl !== null

  return {
    showViewOnlyNotice: !canManage,
    showRevokedNotice: revoked && !hasUrl,
    showIssueForm: canManage && !hasActiveToken,
    showActiveLinkNotice: hasActiveToken && !hasUrl,
    showActions: canManage && hasActiveToken,
    activeLinkDetail: formatActiveLinkDetail(tokenStatus),
    graceLabel: formatTimestamp(tokenStatus.graceExpiresAt),
  }
}

export type MutationState = Readonly<{
  /** First error across the three mutations; `Action.error` is `unknown`. */
  error: unknown
  isPending: boolean
}>

export function resolveMutationState(mutations: PortalShareMutations): MutationState {
  const { issueMutation, rotateMutation, revokeMutation } = mutations
  return {
    error: issueMutation.error ?? rotateMutation.error ?? revokeMutation.error,
    isPending:
      issueMutation.isPending || rotateMutation.isPending || revokeMutation.isPending,
  }
}

/** Narration for the polite live region; empty string keeps it silent. */
export function liveStatusMessage(isPending: boolean, copied: boolean): string {
  if (isPending) return 'Updating the portal public link'
  return copied ? 'Portal link copied' : ''
}
