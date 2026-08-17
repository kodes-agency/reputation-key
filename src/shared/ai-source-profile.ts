export const AI_SOURCE_POLICY_ID_V1 = 'google-business-profile-source-policy-v1' as const

export const AI_SOURCE_CANONICALIZER_DIGEST_V1 =
  'df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5' as const

export const AI_SOURCE_CANONICALIZER_PROFILE_V1 = Object.freeze({
  sourcePolicyId: AI_SOURCE_POLICY_ID_V1,
  sourceCanonicalizerDigest: AI_SOURCE_CANONICALIZER_DIGEST_V1,
})
