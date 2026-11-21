export const AI_SOURCE_POLICY_ID_V1 = 'google-business-profile-source-policy-v1' as const

/**
 * Identity of the source canonicalizer a binding was made under: the SHA-256
 * of the rules in `ai-source-profile.test.ts`, which that test recomputes.
 * Every operation records it (`ai_operations.source_canonicalizer_digest`).
 *
 * Revision 2 of the text rules (`AI_SOURCE_TEXT_REVISION`, 2026-10-14) turns a
 * line break or tab between two words into a space, where revision 1 deleted
 * it and fused the words. Revision 1 was `df0c9ea9…fcac5`. The policy id above
 * is unchanged: the database pins it, and it names the Google source policy,
 * not the canonicalizer.
 *
 * Kept free of imports: the Merchant AI notice DTO reaches this module from
 * code that ships to the browser.
 */
export const AI_SOURCE_CANONICALIZER_DIGEST_V1 =
  'b1bc2fefc65ac62fd46dbc6e834c5043792dc287a8f49696ffa413302b0b9d49' as const

export const AI_SOURCE_CANONICALIZER_PROFILE_V1 = Object.freeze({
  sourcePolicyId: AI_SOURCE_POLICY_ID_V1,
  sourceCanonicalizerDigest: AI_SOURCE_CANONICALIZER_DIGEST_V1,
})
