import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AI_REVIEW_SOURCE_CONTRACT_VERSION,
  AI_SOURCE_TEXT_REVISION,
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from './ai-review-source-contract'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  AI_SOURCE_CANONICALIZER_DIGEST_V1,
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
  AI_SOURCE_POLICY_ID_V1,
} from './ai-source-profile'

/**
 * What the canonicalizer does, in words. The digest in `ai-source-profile.ts`
 * is the hash of this document, so a binding that records the digest records
 * which rules produced the text the model read. Change a rule in
 * `ai-review-source-contract.ts` and the vectors fail; change the words here and
 * this test fails until the digest is moved on purpose.
 */
const CANONICALIZER_RULES = Object.freeze({
  contractVersion: AI_REVIEW_SOURCE_CONTRACT_VERSION,
  textRevision: AI_SOURCE_TEXT_REVISION,
  unicodeNormalization: 'NFKC, and again after the deletions below',
  lineBreaksAndTabs:
    'U+0009..U+000D and U+0085: a run between two non-whitespace scalars is one U+0020, at the start or end or beside whitespace it is deleted',
  otherControlsAndBidiMarks: 'deleted',
  unicodeNoncharacters: 'replaced by U+FFFD',
  reviewerDisplayName: 'masked in place as [PERSON] by folded scalar-interval match',
  closedPlaceholdersInSource: 'escaped as {#1#}..{#6#}',
  maximumCanonicalBytes: MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  maximumRawBytes: MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
})

describe('source canonicalizer profile', () => {
  it('is the hash of the rules it names', () => {
    const expected = createHash('sha256')
      .update('repkey-ai-source-canonicalizer-profile-v1\0', 'utf8')
      .update(canonicalizeRfc8785(CANONICALIZER_RULES), 'utf8')
      .digest('hex')
    expect(AI_SOURCE_CANONICALIZER_DIGEST_V1).toBe(expected)
  })

  it('is no longer the digest of the first revision, which deleted line breaks', () => {
    expect(AI_SOURCE_CANONICALIZER_DIGEST_V1).not.toBe(
      'df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5',
    )
  })

  it('keeps the source policy identity that the database constrains', () => {
    expect(AI_SOURCE_CANONICALIZER_PROFILE_V1).toEqual({
      sourcePolicyId: AI_SOURCE_POLICY_ID_V1,
      sourceCanonicalizerDigest: AI_SOURCE_CANONICALIZER_DIGEST_V1,
    })
    expect(AI_SOURCE_POLICY_ID_V1).toBe('google-business-profile-source-policy-v1')
  })
})
