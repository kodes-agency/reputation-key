// What to do when the Google egress gateway is configured but no usable
// Google Content approval is installed.
//
// WHY THIS EXISTS. Approvals are byte-pinned to the compiled contract and carry
// a 29-day window. When an approval-bound value moves — most often
// `GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION` — or the window simply lapses, the
// installed binding stops satisfying the runtime schema. Until 2026-08-31 the
// composition root's response to that was to THROW, so `createContainer` failed
// and the process could not start at all:
//
//   Error: Google egress gateway requires Google Content runtime approval
//
// That took `worker` down completely and left `web` serving static pages while
// every server function failed, with a green activation gate — because
// `/api/health/ready` does not build the container.
//
// Refusing to start is the right answer where an unapproved Google path is a
// compliance event. It is the wrong answer for a closed beta with one operator,
// because the approval expires on a 29-day clock: the same total outage would
// recur every month, and the fix — re-signing — needs a human with a keystore
// password who may be asleep.
//
// So the disposition is keyed on posture. At `closed-beta` a missing approval
// DISABLES the Google capability and the process boots; the executor is left
// undefined, which is exactly the state the container is already in when no
// gateway is configured at all, so nothing downstream needs a new code path. At
// every wider posture it still refuses, unchanged.
//
// This does not weaken what the approval gates. An unapproved Google path
// cannot execute either way — the difference is whether the rest of the product
// stays up while it is unavailable.

import { CURRENT_RELEASE_POSTURE, type ReleasePosture } from './release-posture'

export type GoogleApprovalGapDisposition =
  /** Approval present: wire the Google authorized provider executor. */
  | 'wire'
  /** No approval, closed beta: boot with the Google capability unavailable. */
  | 'disable'
  /** No approval, wider audience: refuse to start. */
  | 'refuse'

export function googleApprovalGapDisposition(
  input: Readonly<{
    /** The gateway trio (origin, server name, credential keys) is present. */
    gatewayConfigured: boolean
    /** A runtime binding map AND a content authority both resolved. */
    approvalUsable: boolean
  }>,
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
): GoogleApprovalGapDisposition {
  if (!input.gatewayConfigured) return 'disable'
  if (input.approvalUsable) return 'wire'
  return posture === 'closed-beta' ? 'disable' : 'refuse'
}
