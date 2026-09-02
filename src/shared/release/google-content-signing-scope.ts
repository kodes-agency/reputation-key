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
 * The capabilities a signing run should cover.
 *
 * `introduce` is how a capability gets its FIRST approval. Without it the scope
 * is drawn only from rows that already exist, which is correct for a refresh
 * and is why `property.connect_gbp` and `property.publish_reply` could never be
 * approved here: the signer had no input for a capability with no row, so
 * review sync and reply publication were unreachable by construction rather
 * than by decision. Introducing one is deliberate — it is named on the command
 * line, it must be a real contract capability, and it is refused outright if a
 * row already exists, because that is a refresh and must not silently become an
 * introduction.
 *
 * @param present capabilities that have at least one approval row today.
 * @param introduce capabilities being approved for the first time.
 */
export function googleContentSigningScope(
  present: readonly string[],
  posture: ReleasePosture = CURRENT_RELEASE_POSTURE,
  introduce: readonly string[] = [],
): SigningScope {
  const unknown = introduce.filter(
    (capability) =>
      !(GOOGLE_CONTENT_CAPABILITIES as readonly string[]).includes(capability),
  )
  if (unknown.length > 0) {
    return Object.freeze({
      ok: false as const,
      reason: `not a Google Content capability: ${unknown.join(', ')}`,
    })
  }
  const alreadyApproved = introduce.filter((capability) => present.includes(capability))
  if (alreadyApproved.length > 0) {
    return Object.freeze({
      ok: false as const,
      reason: `already approved, so this is a refresh and not an introduction: ${alreadyApproved.join(', ')}`,
    })
  }
  const approved = GOOGLE_CONTENT_CAPABILITIES.filter(
    (capability) => present.includes(capability) || introduce.includes(capability),
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
