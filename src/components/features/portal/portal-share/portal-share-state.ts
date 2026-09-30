// Every branch behind the Share tab lives here so the components stay flat
// descriptions of what is on screen: which blocks show, what the code block says
// about when it was made, and what the screen reader is told.

import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import type { PortalShareMutations } from './portal-share-types'

// Fixed locale + UTC so the server and client render the same string (same
// reason as property-dashboard-review-row.tsx): a mismatch hydrates as an error.
const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatTimestamp(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : timestampFormatter.format(date)
}

export type PortalShareView = Readonly<{
  showViewOnlyNotice: boolean
  showRevokedNotice: boolean
  /** No code yet (or every code was stopped): offer to make one. */
  showIssueForm: boolean
  /** A code exists: the code block is on screen. */
  showCode: boolean
  /** The address is in memory (only after a code was made or replaced). */
  showAddress: boolean
  /** Replace and stop. */
  showActions: boolean
  /** `4 Jan 2026`, the day the live code was made; null when unknown. */
  madeLabel: string | null
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
  // so `publicUrl` cannot answer "is a code live?" after a reload — deriving the
  // replace/stop affordances from it left a leaked QR permanently unrevocable.
  // `tokenStatus` (C2, returned by getPortal) is the durable answer; in-session
  // issue/revoke outcomes run ahead of it until the detail query refetches, so
  // they take precedence.
  const hasActiveToken = !revoked && (publicUrl !== null || tokenStatus.hasActiveToken)

  return {
    showViewOnlyNotice: !canManage,
    showRevokedNotice: revoked && publicUrl === null,
    showIssueForm: canManage && !hasActiveToken,
    showCode: hasActiveToken,
    showAddress: hasActiveToken && publicUrl !== null,
    showActions: canManage && hasActiveToken,
    madeLabel: formatTimestamp(tokenStatus.issuedAt),
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
  if (isPending) return 'Updating the portal code'
  return copied ? 'Address copied' : ''
}
