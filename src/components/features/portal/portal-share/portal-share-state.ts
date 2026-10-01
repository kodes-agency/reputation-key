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
  /** The address is in memory (after a code was made or replaced, or fetched again). */
  showAddress: boolean
  /**
   * The public-address row is on screen: the address is in memory, or the
   * manager can fetch it. Without a keyring it is absent after a reload.
   */
  showAddressRow: boolean
  /**
   * The address was sealed when the code was made and the keyring still holds
   * its key, so a manager can have it again (ADR 0064).
   */
  canDownloadAgain: boolean
  /**
   * "Save this address now": only for an address that cannot be fetched again.
   * With a keyring there is nothing to lose by leaving.
   */
  showSaveWarning: boolean
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
  /** The in-memory address was fetched again, not made in this session. */
  addressRevealed?: boolean
  /** The clock; injectable so "made today" is testable. */
  now?: Date
}>

/**
 * The address for websites, emails and booking messages. Issue and rotate return
 * the QR address, which carries an `accessArtifact` marker: a visit that carries
 * it is recorded as a scan from that artifact's channel, so showing it here
 * would count every website click as a QR scan.
 */
export function directPortalAddress(address: string): string {
  try {
    const url = new URL(address)
    url.searchParams.delete('accessArtifact')
    return url.toString()
  } catch {
    return address
  }
}

export function derivePortalShareView(input: ViewInput): PortalShareView {
  const {
    canManage,
    revoked,
    publicUrl,
    tokenStatus,
    addressRevealed = false,
    now = new Date(),
  } = input

  // The raw URL only exists in memory for the render that issued or rotated it,
  // so `publicUrl` cannot answer "is a code live?" after a reload — deriving the
  // replace/stop affordances from it left a leaked QR permanently unrevocable.
  // `tokenStatus` (C2, returned by getPortal) is the durable answer; in-session
  // issue/revoke outcomes run ahead of it until the detail query refetches, so
  // they take precedence.
  const hasActiveToken = !revoked && (publicUrl !== null || tokenStatus.hasActiveToken)
  const canDownloadAgain = canManage && hasActiveToken && tokenStatus.addressRecoverable

  return {
    showViewOnlyNotice: !canManage,
    showRevokedNotice: revoked && publicUrl === null,
    showIssueForm: canManage && !hasActiveToken,
    showCode: hasActiveToken,
    showAddress: hasActiveToken && publicUrl !== null,
    showAddressRow: hasActiveToken && (publicUrl !== null || canDownloadAgain),
    canDownloadAgain,
    showSaveWarning:
      hasActiveToken && publicUrl !== null && !tokenStatus.addressRecoverable,
    showActions: canManage && hasActiveToken,
    // A code made in this session is newer than whatever tokenStatus last saw;
    // an address fetched again belongs to the code tokenStatus describes.
    madeLabel:
      !revoked && publicUrl !== null && !addressRevealed
        ? formatTimestamp(now.toISOString())
        : formatTimestamp(tokenStatus.issuedAt),
    graceLabel: formatTimestamp(tokenStatus.graceExpiresAt),
  }
}

export type MutationState = Readonly<{
  /** First error across the four mutations; `Action.error` is `unknown`. */
  error: unknown
  isPending: boolean
}>

export function resolveMutationState(mutations: PortalShareMutations): MutationState {
  const { issueMutation, rotateMutation, revokeMutation, revealMutation } = mutations
  return {
    error:
      issueMutation.error ??
      rotateMutation.error ??
      revokeMutation.error ??
      revealMutation.error,
    isPending:
      issueMutation.isPending ||
      rotateMutation.isPending ||
      revokeMutation.isPending ||
      revealMutation.isPending,
  }
}

/** Narration for the polite live region; empty string keeps it silent. */
export function liveStatusMessage(isPending: boolean, copied: boolean): string {
  if (isPending) return 'Updating the portal code'
  return copied ? 'Address copied' : ''
}
