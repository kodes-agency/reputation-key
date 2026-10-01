// Every branch behind the Share tab lives here so the components stay flat
// descriptions of what is on screen: which blocks show, what the code block says
// about when it was made, and what the screen reader is told.

import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import type { PortalShareMutations, PortalShareProps } from './portal-share-types'

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
  /**
   * Who made the live code, by display name; null when unknown, and for a code
   * made in this session until `tokenStatus` has caught up with it.
   */
  madeBy: string | null
  graceLabel: string | null
}>

type ViewInput = Readonly<{
  canManage: boolean
  revoked: boolean
  publicUrl: string | null
  tokenStatus: PortalTokenStatus
  /** The in-memory address was fetched again, not made in this session. */
  addressRevealed?: boolean
  /** From the issue or replace result; overrides the stale `tokenStatus` value. */
  addressRecoverable?: boolean
  /**
   * The version of the code made in this session (from the issue or replace
   * result). `tokenStatus` describes it once its own version reaches this one;
   * until then it still describes the code that was replaced.
   */
  issuedVersion?: number | null
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
    addressRecoverable = tokenStatus.addressRecoverable,
    issuedVersion = null,
    now = new Date(),
  } = input

  // The raw URL only exists in memory for the render that issued or rotated it,
  // so `publicUrl` cannot answer "is a code live?" after a reload — deriving the
  // replace/stop affordances from it left a leaked QR permanently unrevocable.
  // `tokenStatus` (C2, returned by getPortal) is the durable answer; in-session
  // issue/revoke outcomes run ahead of it until the detail query refetches, so
  // they take precedence.
  const hasActiveToken = !revoked && (publicUrl !== null || tokenStatus.hasActiveToken)
  const canDownloadAgain = canManage && hasActiveToken && addressRecoverable
  // A code made here is newer than what `tokenStatus` last saw, until its
  // refetch reaches the version that was made.
  const tokenStatusCaughtUp =
    issuedVersion !== null &&
    tokenStatus.version !== null &&
    tokenStatus.version >= issuedVersion
  const madeInThisSession =
    !revoked && publicUrl !== null && !addressRevealed && !tokenStatusCaughtUp

  return {
    showViewOnlyNotice: !canManage,
    showRevokedNotice: revoked && publicUrl === null,
    showIssueForm: canManage && !hasActiveToken,
    showCode: hasActiveToken,
    showAddress: hasActiveToken && publicUrl !== null,
    showAddressRow: hasActiveToken && (publicUrl !== null || canDownloadAgain),
    canDownloadAgain,
    showSaveWarning: hasActiveToken && publicUrl !== null && !addressRecoverable,
    showActions: canManage && hasActiveToken,
    // While tokenStatus still describes the code that was replaced, the day is
    // today and the maker is not known to it; an address fetched again belongs
    // to the code tokenStatus describes.
    madeLabel: madeInThisSession
      ? formatTimestamp(now.toISOString())
      : formatTimestamp(tokenStatus.issuedAt),
    madeBy: madeInThisSession || revoked ? null : tokenStatus.madeBy,
    graceLabel: formatTimestamp(tokenStatus.graceExpiresAt),
  }
}

/** "Made 12 Mar 2026 by Georgi Ivanov"; the date alone when nobody can be named. */
export function describeMadeCode(
  madeLabel: string | null,
  madeBy: string | null,
): string | null {
  if (madeLabel === null) return null
  return madeBy === null ? `Made ${madeLabel}` : `Made ${madeLabel} by ${madeBy}`
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

/** The scan-goal readiness notice shows while a code exists but cannot yet qualify. */
export function showScanGoalReadiness(
  props: Pick<PortalShareProps, 'revoked' | 'tokenStatus'>,
  publicUrl: string | null,
): boolean {
  return (
    !props.revoked &&
    publicUrl === null &&
    props.tokenStatus.hasActiveToken &&
    !props.tokenStatus.qualifiedScanReady
  )
}

/** Share view derived straight from the tab's props and the held address. */
export function derivePortalShareViewFromProps(
  props: PortalShareProps,
  canManage: boolean,
  publicUrl: string | null,
): PortalShareView {
  return derivePortalShareView({
    canManage,
    revoked: props.revoked,
    publicUrl,
    tokenStatus: props.tokenStatus,
    addressRevealed: props.issuedLink?.revealed ?? false,
    addressRecoverable: props.issuedLink?.addressRecoverable,
    issuedVersion: props.issuedLink?.version ?? null,
  })
}
