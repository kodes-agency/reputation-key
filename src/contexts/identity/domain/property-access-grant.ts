// Identity context — what a grant command does with the grant already there.
//
// One (Organization, Property, user) holds at most one unrevoked grant, and a
// grant past its expiry is still unrevoked: it gives no access but keeps the
// slot until a revoke retires it. The two commands that grant one member a
// Property on request — the operator surface and the Members access edit —
// decide here, so they cannot disagree about a lapsed grant. Invitation
// provisioning grants through its own path and offboarding revokes in bulk;
// neither decides here.

/** The unrevoked grant found under the grant lock. */
export type CurrentPropertyGrant = Readonly<{ expiresAt: Date | null }>

export type PropertyGrantRequest = Readonly<{
  current: CurrentPropertyGrant | null
  /** When the requested grant lapses; `null` grants without an expiry. */
  expiresAt: Date | null
  /**
   * Whether the command sets the term of a grant that is still active. The
   * operator names an expiry, so asking for another one replaces the grant.
   * The Members edit names none: it grants access now and leaves a grant that
   * already gives it alone.
   */
  replacesActiveTerm: boolean
  now: Date
}>

/**
 * - `insert`: nothing holds the slot; write the grant.
 * - `supersede`: retire the current grant as superseded, then write the grant.
 * - `keep`: the current grant already gives what was asked; change nothing.
 */
export type PropertyGrantDecision = 'insert' | 'supersede' | 'keep'

/** A grant lapses at its expiry instant, the bound every access read uses. */
const hasLapsed = (grant: CurrentPropertyGrant, now: Date): boolean =>
  grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()

const sameTerm = (left: Date | null, right: Date | null): boolean =>
  left === null || right === null ? left === right : left.getTime() === right.getTime()

export function decidePropertyGrant(
  request: PropertyGrantRequest,
): PropertyGrantDecision {
  const { current } = request
  if (current === null) return 'insert'
  if (hasLapsed(current, request.now)) return 'supersede'
  if (!request.replacesActiveTerm) return 'keep'
  return sameTerm(current.expiresAt, request.expiresAt) ? 'keep' : 'supersede'
}
