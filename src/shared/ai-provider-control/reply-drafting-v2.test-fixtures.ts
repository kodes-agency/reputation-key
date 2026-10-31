import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import { replyRequest } from '#/shared/ai-gateway-transport-contract.test-fixtures'
import type { ReplySuggestionGatewayRequestV1 } from '#/shared/ai-gateway-transport-contract'
import {
  canonicalizeRawAiReviewSource,
  canonicalizeRawAiReviewSentences,
} from '#/shared/ai-review-source-contract'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import { AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST } from '#/shared/ai-reply-output-leakage'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/ai-reply-template-catalogue'
import { resolveReplyDraftingV2Options } from '#/shared/reply-drafting-v2-request'

export function replyV2Request(
  text = 'We waited a long time. The room was quiet.',
  languageCode = 'en-Latn',
): ReplySuggestionGatewayRequestV1 {
  const base = replyRequest()
  const raw = {
    text,
    languageCode,
    rating: 2 as const,
    reviewedAtEpochMillis: base.source.reviewedAtEpochMillis,
    reviewerDisplayName: null,
  }
  return {
    ...base,
    replyProfileVersion: 'reply-draft-v4',
    binding: {
      ...base.binding,
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      operationProfileVersion: 'reply-suggestion-v2',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v2',
      evaluatedLanguage: languageCode,
      concreteReplyLanguage: { tag: languageCode, templateGroup: languageCode },
      replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
      zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
      outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      replyDraftingV2: {
        options: resolveReplyDraftingV2Options({ languageCode, variation: 1 }),
        voiceDigest: 'a'.repeat(64),
        generationSeed: 'b'.repeat(64),
        parentOperationId: null,
        rewriteOrdinal: 0,
        rewriteIssues: [],
      },
    },
    source: {
      ...base.source,
      text: canonicalizeRawAiReviewSource(raw).text,
      rating: raw.rating,
      languageCode: raw.languageCode,
      kind: 'review',
      sentences: [...canonicalizeRawAiReviewSentences(raw)],
    },
    replyV2Frame: {
      voiceDigest: 'a'.repeat(64),
      reviewerDisplayName: 'Jane',
      businessName: 'Example Hotel',
      contact: 'private@example.test',
      signerName: 'Manager',
      signerTitle: 'Owner',
      candidates: [
        {
          prefix: '',
          suffix: '',
          thanks: false,
          choices: {
            closing: -1,
            signOff: 0,
            contactSentence: 0,
            emoji: 0,
            includeContact: true,
          },
        },
      ],
    },
  }
}
