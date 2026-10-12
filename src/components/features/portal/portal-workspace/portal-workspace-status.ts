// What the workspace header's one quiet line adds when guests cannot open a live
// portal. It asks the Portals list's own attention rule (`portalAttention`), so
// a portal reads the same in its workspace as in the list, and keeps only the
// issues that stop guests: the property is unavailable, there is no version to
// show, or no code works. The rest (no responsible manager, the Google link)
// leave the page reachable, so they do not change a line that says "Live".
//
// It stays one line, not a panel (round-4 owner decision): "Live · no working
// code", where the problem is a link to the place that puts it right.

import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'
import { describePortalStatus } from '../portal-detail/portal-detail-rules'
import {
  portalAttention,
  type PortalAttentionInput,
  type PortalIssueCode,
} from '../portal-overview/portal-attention'
import type { PortalPublicationState } from '../shared/types'

export type WorkspaceStatusProblem = Readonly<{
  /** Lower case: it follows the status after a dot ("Live · no working code"). */
  text: string
  /** Where it is put right: the Share tab (make a code), Review & publish, or nowhere here. */
  fix: 'share' | 'review' | null
}>

type BlockingCode = Extract<
  PortalIssueCode,
  'property_unavailable' | 'no_live_version' | 'no_code'
>

const BLOCKING: Readonly<Record<BlockingCode, WorkspaceStatusProblem>> = {
  property_unavailable: { text: 'property unavailable', fix: null },
  no_live_version: { text: 'no version guests can open', fix: 'review' },
  no_code: { text: 'no working code', fix: 'share' },
}

const isBlocking = (code: PortalIssueCode): code is BlockingCode => code in BLOCKING

export type WorkspaceStatusInput = Readonly<{
  publicationState: PortalPublicationState
  /** The property is active: a paused or removed property takes its portals down. */
  propertyAvailable: boolean
  /** A version is live (the publication history's `current`). */
  hasLiveVersion: boolean
  token: PortalTokenStatus
}>

/** The health the list would hold for these facts, in the order the server checks them. */
function healthOf(input: WorkspaceStatusInput): PortalAttentionInput['health'] {
  if (!input.propertyAvailable) {
    return { status: 'unavailable', reason: 'property_unavailable' }
  }
  if (!input.hasLiveVersion) {
    return { status: 'unavailable', reason: 'publication_snapshot_unavailable' }
  }
  return null
}

/** The first problem that stops guests opening a live portal, or null when there is none. */
export function workspaceStatusProblem(
  input: WorkspaceStatusInput,
): WorkspaceStatusProblem | null {
  const attention = portalAttention({
    publicationState: input.publicationState,
    health: healthOf(input),
    pendingChangeCount: 0,
    token: input.token,
    // Responsibility never stops guests; the issue it raises is not kept below.
    responsibleManagerUserIds: [],
  })
  if (attention.kind !== 'issues') return null
  const first = attention.issues.map((issue) => issue.code).find(isBlocking)
  return first === undefined ? null : BLOCKING[first]
}

export type WorkspaceStatus = Readonly<{
  /** `describePortalStatus`'s line: "Live · version 5", "Draft · not published". */
  line: string
  problem: WorkspaceStatusProblem | null
}>

/**
 * The whole quiet line. It says "up to date" only when the live page matches
 * its draft and nothing stops guests opening it, so a portal is never "up to
 * date" beside "no working code".
 */
export function workspaceStatus(
  input: WorkspaceStatusInput &
    Readonly<{ liveVersion: number | null; hasPendingChanges: boolean }>,
): WorkspaceStatus {
  const problem = workspaceStatusProblem(input)
  const upToDate = !input.hasPendingChanges && problem === null
  return {
    line: describePortalStatus(input.publicationState, input.liveVersion, upToDate),
    problem,
  }
}
