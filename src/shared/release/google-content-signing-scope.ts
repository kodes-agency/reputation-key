// Which Google Content capabilities a re-signing run must cover.
//
// WHY THIS EXISTS. `ops:google-content-approval-sign` re-signs the CURRENT
// approved rows against the compiled contract — it never mints new evidence, it
// only refreshes signatures when an approval-bound value moves. It refused to
// run at all unless every one of the four capabilities had an approval row:
//
//   no approval row to re-sign for: property.connect_gbp, property.publish_reply
//
// The closed beta has rows for exactly two — `property.import_gbp_v2` and
// `property.read_gbp_performance`, verified against the live database. So the
// command could never run here, which is how a route-catalogue bump ended up
// taking the Google capabilities down with no way to re-sign them.
//
// The requirement was never really "all four exist"; it was "do not silently
// re-sign a subset of a set that is supposed to be complete". That is a real
// concern for the production cell, where all four capabilities are in scope. It
// is meaningless for a deployment that only ever approved two: there is nothing
// partial about re-signing everything there is.
//
// So the scope is keyed on posture, and it can never invent an approval — it
// only ever returns capabilities that already have a row. A run with no rows at
// all is still refused at every posture, because that is the case where the
// operator is asking to sign something that was never approved.

import {
  GOOGLE_CONTENT_CAPABILITIES,
  type GoogleContentCapability,
} from '#/shared/auth/google-content-contract'
import { CURRENT_RELEASE_POSTURE, type ReleasePosture } from './release-posture'

export type SigningScope =
  | Readonly<{ ok: true; capabilities: readonly GoogleContentCapability[] }>
  | Readonly<{ ok: false; reason: string }>

/**
 * The capabilities a re-signing run should cover, given what is approved.
 *
 * @param present capabilities that have at least one approval row today.
 */
export function googleContentSigningScope(
  present: readonly string[],
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
): SigningScope {
  const approved = GOOGLE_CONTENT_CAPABILITIES.filter((capability) =>
    present.includes(capability),
  )
  if (approved.length === 0) {
    return Object.freeze({
      ok: false as const,
      reason:
        'no Google Content approval rows exist to re-sign; this command refreshes existing approvals and cannot create one',
    })
  }
  if (posture === 'closed-beta') {
    return Object.freeze({ ok: true as const, capabilities: Object.freeze(approved) })
  }
  const missing = GOOGLE_CONTENT_CAPABILITIES.filter(
    (capability) => !present.includes(capability),
  )
  if (missing.length > 0) {
    return Object.freeze({
      ok: false as const,
      reason: `no approval row to re-sign for: ${missing.join(', ')}`,
    })
  }
  return Object.freeze({ ok: true as const, capabilities: Object.freeze(approved) })
}
