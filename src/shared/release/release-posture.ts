// The audience this product is released to.
//
// WHAT READS IT. Posture was introduced so release gates could scale their
// demands to the audience. Those gates were deleted in September 2026
// (4085491ee, 23d6fe14d). One reader remains: the migration binary passes the
// posture to `railwayDeploymentTargetFor`, which names the only Railway project
// and environment it may run against. The closed beta deploys to its single
// environment; a wider posture moves deploys to the dedicated cell. What the
// audience itself is, and what it is promised, lives in docs/BETA.md.
//
// WHY A CONSTANT AND NOT AN ENVIRONMENT VARIABLE. Posture is a property of the
// product's AUDIENCE, not of a deployment, so a per-environment value would be
// free to disagree with itself for no reason. And as a constant, widening the
// audience is a dated, attributable, reviewable diff that the compiler sees; as
// an environment variable it would be a dashboard click that leaves no trace.

/**
 * Every release posture, ordered from the narrowest audience to the widest.
 *
 * Order is load-bearing: `releasePostureRank` is index-based, so reordering
 * this array changes what `isPostureAtLeast` answers. A test pins the sequence.
 */
export const RELEASE_POSTURES = ['closed-beta', 'open-beta', 'ga'] as const

export type ReleasePosture = (typeof RELEASE_POSTURES)[number]

/**
 * The posture this product is in.
 *
 * `closed-beta` is the invite-only beta that docs/BETA.md describes:
 * Organizations and Properties are provisioned by an operator (ADR 0065), with
 * no fixed count, and self-service registration is off.
 *
 * Changing this line widens the audience. In code it changes one thing: the
 * Railway target the migration binary accepts moves from the closed-beta
 * environment to the dedicated cell (`railwayDeploymentTargetFor`). Everything
 * else a wider audience needs is a decision in docs/BETA.md, not a gate that
 * arms itself.
 */
export const CURRENT_RELEASE_POSTURE: ReleasePosture = 'closed-beta'

/** How wide the audience is. Higher is wider. */
export function releasePostureRank(posture: ReleasePosture): number {
  return RELEASE_POSTURES.indexOf(posture)
}

/**
 * Is `actual` an audience at least as wide as `required`?
 *
 * This is the whole arming predicate. A gate is armed when the current posture
 * has reached the posture the gate declares.
 */
export function isPostureAtLeast(
  actual: ReleasePosture,
  required: ReleasePosture,
): boolean {
  return releasePostureRank(actual) >= releasePostureRank(required)
}
