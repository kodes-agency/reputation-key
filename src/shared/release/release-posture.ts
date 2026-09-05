// The audience this product is currently exposed to, and the ordering that
// decides which gates that audience earns.
//
// WHY THIS EXISTS. Posture used to exist only as a field an evidence bundle
// asserted about itself. Nothing anywhere stated what posture the product is
// actually in, so every gate that wanted to scale its demand to the audience
// had nothing to consult and had to assume the widest one. That is why a closed
// beta with a single participant was being held to a gate set written for a
// public launch: not by decision, but because the question could not be asked.
//
// WHY A CONSTANT AND NOT AN ENVIRONMENT VARIABLE. Posture is a property of the
// product's AUDIENCE, not of a deployment. Local, staging and the Railway beta
// all serve the same one person today, so a per-environment value would be
// free to disagree with itself for no reason. The decisive argument is the
// audit trail: as a constant, widening the audience is a dated, attributable,
// reviewable diff that the compiler sees. As an environment variable it is a
// dashboard click that leaves no trace — at which point "posture-scoped" and
// "deleted, with extra steps" become the same thing, and the entire reason to
// prefer the first over the second disappears.
//
// A note on direction. Postures widen left to right, and gates get MORE
// demanding as the audience widens. So a gate declares the NARROWEST posture at
// which it arms, and stays armed for every posture above it. A gate that must
// always hold declares `closed-beta` — armed from the narrowest audience
// onward, which is to say always.

/**
 * Every release posture, ordered from the narrowest audience to the widest.
 *
 * Order is load-bearing: `releasePostureRank` is index-based, so reordering
 * this array silently rearms or disarms gates. A test pins the sequence.
 */
export const RELEASE_POSTURES = ['closed-beta', 'open-beta', 'ga'] as const

export type ReleasePosture = (typeof RELEASE_POSTURES)[number]

/**
 * The posture this product is in.
 *
 * `closed-beta` means an audience of exactly one — the owner — operating on
 * their own Google Business Profile. There are no third-party data subjects,
 * no second principal, and no one to countersign anything.
 *
 * Changing this line widens the audience. Read `gate-policy.ts` first: every
 * gate that was dormant below the new posture arms itself the moment this
 * changes, which is the intended behaviour and not a side effect.
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
