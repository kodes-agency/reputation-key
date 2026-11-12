import { digestOf } from './ai-digest'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from './ai-reply-output-leakage'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from './ai-structured-marker-detectors'
import {
  AI_PERSONALIZED_REPLY_LANGUAGES,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from './ai-personalized-reply-profile'

/*
 * `\w` and `\b` are ASCII-only in JavaScript, with or without the `u` flag, so
 * the Bulgarian patterns spell a word's tail `\p{L}*`. With `\w*` three of the
 * four of them could match only text that is not Bulgarian: after the stem comes
 * a Cyrillic letter, `\w*` takes nothing, and the `\s+` that follows meets a
 * letter. The patterns are part of the profile digest below.
 */
/* eslint-disable security/detect-unsafe-regex -- every repeated unit is a literal stem plus one letter class, followed by whitespace or the end; nothing overlaps, and a reply is at most 1,200 characters */
const PROHIBITED_REPLY_PATTERNS = Object.freeze([
  // Compensation, pricing, or commitments that the Review cannot authorize.
  /\b(?:refund\w*|reimburs\w*|compensat\w*|free\s+(?:stay|night|meal|upgrade|room)s?|free\s+\w+(?:\s+\w+)?\s+on\s+us|money\s+back|voucher\w*|discount\w*|on\s+the\s+house|guarantee\w*|promise\w*)\b/iu,
  // Admissions or legal conclusions.
  /\b(?:liable|liability|admit\w*\s+(?:fault|liability)|our\s+fault|at\s+fault|(?:take|takes|taking|took|accept\w*)\s+(?:full\s+)?responsibility|full\s+responsibility)\b/iu,
  // Bulgarian equivalents of compensation, promises, and admissions. A refund
  // may name the sum or the price a few words after the verb (`ще ви върнем
  // платената сума`) or before it (`сумата ще ви бъде възстановена`).
  /(?:обезщет\p{L}*|компенс\p{L}*|(?:възстанов|върн)\p{L}*(?:\s+\p{L}+){0,3}?\s+(?:сум|пар|цен)\p{L}*|(?:сум|пар|цен)\p{L}*(?:\s+\p{L}+){0,3}?\s+(?:възстановен|върнат)\p{L}*|безплат\p{L}*\s+(?:нощув\p{L}*|престо\p{L}*|хран\p{L}*|ъпгрейд\p{L}*|надграж\p{L}*)|ваучер\p{L}*|отстъпк\p{L}*|гарантир\p{L}*|обеща\p{L}*|признав\p{L}*\s+(?:си\s+)?(?:вин|грешк)\p{L}*|пое\p{L}*\s+(?:пълна\s+)?отговорност\p{L}*|(?:наша|нашата)\s+вина)/iu,
] as const)
/* eslint-enable security/detect-unsafe-regex */

const PROFILE_MANIFEST = Object.freeze({
  version: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
  languages: AI_PERSONALIZED_REPLY_LANGUAGES,
  tones: Object.freeze(['professional', 'friendly', 'casual'] as const),
  grounding: Object.freeze({
    min: 1,
    max: 3,
    exactSourceExcerpt: true,
    selfQuoteContentWordsMustAppearInReply: true,
    selfQuoteContentWordMinimumLength: 3,
  }),
  brandGrounding: Object.freeze({ publicDisplayNameRequired: false }),
  replyText: Object.freeze({ min: 24, max: 1_200 }),
  outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  structuredMarkerDetectorDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  prohibitedPatterns: PROHIBITED_REPLY_PATTERNS.map(({ source, flags }) => ({
    source,
    flags,
  })),
})

export const AI_PERSONALIZED_REPLY_PROFILE_DIGEST = digestOf(
  'repkey-personalized-reply-profile-v1\0',
  PROFILE_MANIFEST,
)

/** Historical en/bg commitment authority, reused by the additive v2 contract. */
export function hasProhibitedReplyCommitment(replyText: string): boolean {
  return PROHIBITED_REPLY_PATTERNS.some((pattern) => pattern.test(replyText))
}
