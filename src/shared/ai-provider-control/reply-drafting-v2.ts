import { createReplyProgressParser } from './reply-progress-parser'
import {
  reportReplyProgress,
  type ReplyDraftingProgressSink,
} from '#/shared/reply-drafting-progress'
import type { KeyObject } from 'node:crypto'
import type { AiReplyOutputRefusal } from './reply-output-refusal'
import type { ReplySuggestionGatewayRequestV1 } from '#/shared/ai-gateway-transport-contract'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewSentences,
} from '#/shared/ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
} from '#/shared/ai-structured-marker-detectors'
import {
  reviewRedactionsAgree,
  reviewSentencesAreNumberedFromOne,
  reviewSentencesMatchText,
} from '#/shared/review-analysis-v3-request'
import {
  parseCanonicalReplyLanguageTag,
  type EvaluatedReviewLanguage,
  type ConcreteReplyLanguage,
} from '#/shared/ai-review-language-catalogue'
import {
  AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
  resolveConcreteReplyLanguage,
  verifyReplyLanguageOutput,
  type ReplyLanguageDetector,
} from '#/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  acceptReplyDraftingV2,
  REPLY_DRAFTING_V2_PROFILE_DIGEST,
} from '#/shared/reply-drafting-v2-contract'
import {
  replyDraftingV2OutputSchema,
  REPLY_DRAFTING_V2_VERSIONS,
  REPLY_DRAFTING_V2_LANGUAGES,
} from '#/shared/reply-drafting-v2-schema'
import {
  buildReplyDraftingV2Payload,
  replyDraftingV2DeveloperMessage,
} from '#/shared/reply-drafting-v2-request'
import { frameReplyDraftingV2 } from '#/shared/reply-drafting-v2-frame'
import { digestAiReplyBrandDisplayName } from '#/shared/ai-reply-brand-profile.server'
import { digestRenderedReply, signAiReplyProvenance } from '#/shared/ai-reply-provenance'
import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import { derivePropertySafetyIdentifier } from './safety-identifier'
import {
  GatewayPreparationError,
  type PreparedGatewayRouteExecution,
  type AcceptedGatewayResult,
} from './contracts'
import type {
  AiProviderPreparation,
  PrepareProviderInvocationInput,
} from './provider-contracts'
import type { ReplyBodyIssueCode } from '#/shared/domain/reply-body-lint-policy'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { AiOperationProfile } from '#/shared/ai-operation-profile-core'

type Dependencies = Readonly<{
  profile: Pick<
    AiOperationProfile,
    'outputSchemaName' | 'maxOutputTokens' | 'reasoningEffort'
  >
  provider: AiProviderPreparation
  text: string
  evaluated: EvaluatedReviewLanguage
  sourceBytes: Uint8Array
  requestBindingKeys: VersionedHmacKeyring
  safetyIdentifierKey: Uint8Array
  replyLanguageDetector: ReplyLanguageDetector
  provenanceKid: string
  provenancePrivateKey: KeyObject
  now: () => number
  createDescriptor: PrepareProviderInvocationInput['createDescriptor']
  onOutputRefused?: (refusal: AiReplyOutputRefusal) => void
}>

function assertPolicy(
  request: ReplySuggestionGatewayRequestV1,
  deps: Dependencies,
): ConcreteReplyLanguage {
  const binding = request.binding
  const target = binding.concreteReplyLanguage
  const concrete = target && parseCanonicalReplyLanguageTag(target.tag)
  if (
    !concrete ||
    !REPLY_DRAFTING_V2_LANGUAGES.some((tag) => tag === concrete.templateGroup)
  )
    throw new GatewayPreparationError('language_not_supported')
  if (
    concrete.templateGroup !== target?.templateGroup ||
    request.replyProfileVersion !== REPLY_DRAFTING_V2_VERSIONS.profile ||
    !binding.replyDraftingV2 ||
    !request.replyV2Frame ||
    request.replyLocalFrame != null
  )
    throw new GatewayPreparationError('invalid_request')
  if (
    request.replyV2Frame.voiceDigest !== binding.replyDraftingV2.voiceDigest ||
    binding.replyBrandDisplayNameDigest !==
      digestAiReplyBrandDisplayName(request.brandProfile.displayName)
  )
    throw new GatewayPreparationError('policy_unavailable')
  if (
    binding.replyLanguageVerifierDigest !== AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST ||
    binding.languageScriptConsistencyDigest !==
      AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST ||
    binding.outputLeakageProfileVersion !== AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION ||
    binding.outputLeakageProfileDigest !== AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST
  )
    throw new GatewayPreparationError('policy_unavailable')
  if (
    resolveConcreteReplyLanguage({
      text: deps.text,
      evaluatedLanguage: deps.evaluated,
      detector: deps.replyLanguageDetector,
    }).status !== 'resolved'
  )
    throw new GatewayPreparationError('language_not_supported')
  return concrete
}

function numberedEvidence(request: ReplySuggestionGatewayRequestV1, wholeText: string) {
  const sentences = request.source.sentences
  if (
    !sentences?.length ||
    request.source.text === null ||
    !reviewSentencesAreNumberedFromOne(sentences) ||
    !reviewSentencesMatchText(request.source.text, sentences)
  )
    throw new GatewayPreparationError('invalid_request')
  const redacted = redactAiReviewSentences({
    sentences: sentences.map(({ text }) => text),
    countryCode: request.redactionCountry,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
  if (
    redacted.status !== 'redacted' ||
    !reviewRedactionsAgree(wholeText, redacted.sentences)
  )
    throw new GatewayPreparationError('redaction_blocked')
  return redacted.sentences.map((text, index) => ({ n: index + 1, text }))
}

function acceptedBody(
  request: ReplySuggestionGatewayRequestV1,
  deps: Dependencies,
  concrete: ConcreteReplyLanguage,
  draft: import('#/shared/reply-drafting-v2-schema').ReplyDraftingV2Output,
): AcceptedGatewayResult | null {
  const frame = request.replyV2Frame!
  const rendered = frameReplyDraftingV2(draft.replyText, frame)
  if (replyCommentProblem(rendered.replyText) !== null)
    return refuseOutput(deps, 'reply_limits')
  const exemptions = [
    frame.reviewerDisplayName,
    frame.contact,
    frame.signerName,
    frame.signerTitle,
    frame.businessName,
  ].filter((span): span is string => span !== null && span.length >= 3)
  if (
    verifyReplyLanguageOutput(
      rendered.replyText,
      concrete,
      deps.replyLanguageDetector,
      exemptions,
    ).status !== 'valid'
  )
    return refuseOutput(deps, 'language_verification')
  const binding = request.binding
  const fence = binding.capabilityFence
  if (fence.capability !== 'reply_drafting')
    return refuseOutput(deps, 'profile_version_mismatch')
  return {
    buildResponse: (receipt, grant) => {
      if (
        grant.replyTokenExpiresAtEpochMillis === null ||
        grant.replyDraftExpiresAtEpochMillis === null ||
        grant.replyTokenExpiresAtEpochMillis <= deps.now()
      ) {
        refuseOutput(deps, 'adoption_window_elapsed')
        throw new GatewayPreparationError('output_invalid')
      }
      const provenanceToken = signAiReplyProvenance(
        {
          version: REPLY_DRAFTING_V2_VERSIONS.provenance,
          kid: deps.provenanceKid,
          operationId: request.operationId,
          actorId: request.actorId,
          organizationId: request.organizationId,
          propertyId: request.propertyId,
          reviewId: request.internalSubjectId,
          requestBindingHmac: grant.requestBindingHmac,
          sourceEpoch: binding.sourceEpoch,
          sourceRevision: binding.sourceRevision!,
          baseReplyStateRevision: fence.baseReplyStateRevision,
          replyDraftingEpoch: fence.replyDraftingEpoch,
          propertyProfileVersion: binding.propertyProfileVersion,
          providerDeploymentProfileVersion: binding.providerDeploymentProfileVersion,
          operationProfileVersion: REPLY_DRAFTING_V2_VERSIONS.operation,
          replyProfileVersion: REPLY_DRAFTING_V2_VERSIONS.profile,
          replyProfileDigest: REPLY_DRAFTING_V2_PROFILE_DIGEST,
          replyBrandProfileVersion: binding.replyBrandProfileVersion!,
          replyBrandDisplayNameDigest: binding.replyBrandDisplayNameDigest!,
          replyVoiceDigest: frame.voiceDigest,
          voiceChoices: rendered.voiceChoices,
          parentOperationId: binding.replyDraftingV2!.parentOperationId,
          rewriteOrdinal: binding.replyDraftingV2!.rewriteOrdinal,
          modelSnapshot: 'gpt-6-luna',
          promptVersion: REPLY_DRAFTING_V2_VERSIONS.prompt,
          outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
          outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
          concreteLanguageTag: concrete.tag,
          templateGroup: concrete.templateGroup,
          renderedSuggestionDigest: digestRenderedReply(rendered.replyText),
          tokenExpiresAtEpochMillis: grant.replyTokenExpiresAtEpochMillis,
          draftExpiresAtEpochMillis: grant.replyDraftExpiresAtEpochMillis,
        },
        deps.provenancePrivateKey,
      )
      return {
        route: 'reply-suggestion',
        status: 'success',
        settlementReceipt: receipt,
        result: {
          profileVersion: REPLY_DRAFTING_V2_VERSIONS.profile,
          replyText: rendered.replyText,
          case: draft.case,
          mainPoint: draft.mainPoint,
          concreteLanguageTag: concrete.tag,
          templateGroup: REPLY_DRAFTING_V2_LANGUAGES.find(
            (tag) => tag === concrete.templateGroup,
          )!,
          provenanceToken,
          expiresAtEpochMillis: grant.replyTokenExpiresAtEpochMillis,
          baseReplyStateRevision: fence.baseReplyStateRevision,
        },
      }
    },
  }
}

export function prepareReplyDraftingV2(
  request: ReplySuggestionGatewayRequestV1,
  deps: Dependencies,
): PreparedGatewayRouteExecution {
  const concrete = assertPolicy(request, deps)
  const sentences = numberedEvidence(request, deps.text)
  const v2 = request.binding.replyDraftingV2!
  const providerPayload = buildReplyDraftingV2Payload({
    rating: request.source.rating,
    tone: request.tone,
    languageCode: concrete.tag,
    options: v2.options,
    sentences,
  })
  const invocation = deps.provider.prepare({
    logical: {
      route: 'reply-suggestion',
      operationId: request.operationId,
      promptVersion: REPLY_DRAFTING_V2_VERSIONS.prompt,
      developerPrompt: replyDraftingV2DeveloperMessage({
        rating: request.source.rating,
        languageCode: concrete.tag,
        variation: v2.options.variation,
        rewriteIssues: v2.rewriteIssues,
      }),
      outputSchemaName: deps.profile.outputSchemaName,
      outputSchema: replyDraftingV2OutputSchema,
      untrustedData: canonicalizeRfc8785(providerPayload),
      maxOutputTokens: deps.profile.maxOutputTokens,
      reasoningEffort: deps.profile.reasoningEffort,
      safetyIdentifier: derivePropertySafetyIdentifier({
        kind: 'interactive',
        organizationId: request.organizationId,
        propertyId: request.propertyId,
        actorId: request.actorId,
        key: deps.safetyIdentifierKey,
      }),
    },
    sourceBytes: deps.sourceBytes,
    providerPayload,
    createDescriptor: deps.createDescriptor,
    requestBindingKeys: deps.requestBindingKeys,
  })
  let issues: readonly ReplyBodyIssueCode[] = []
  let progressSink: ReplyDraftingProgressSink | undefined
  const observeText = createReplyProgressParser(
    sentences.map(({ n }) => n),
    (event) => reportReplyProgress(progressSink, event),
  )
  return {
    providerId: deps.provider.providerId,
    invocation,
    outputSchema: replyDraftingV2OutputSchema,
    observeProviderText: (text, sink) => {
      progressSink = sink
      observeText(text)
    },
    repairIssues: () => issues,
    acceptProviderResult: (output) => {
      issues = []
      const result = acceptReplyDraftingV2({
        output,
        sentences,
        targetLanguageTag: concrete.tag,
        rating: request.source.rating,
        countryCode: request.redactionCountry,
        ...(v2.options.maxWords === undefined ? {} : { maxWords: v2.options.maxWords }),
      })
      if (result.status === 'refused') return refuseOutput(deps, result.reason)
      if (result.status === 'hard_failure') {
        issues = result.findings.filter((f) => f.severity === 'hard').map((f) => f.code)
        for (const code of issues) refuseOutput(deps, code)
        return null
      }
      return acceptedBody(request, deps, concrete, result.draft)
    },
  }
}

function refuseOutput(deps: Dependencies, reason: AiReplyOutputRefusal['reason']): null {
  deps.onOutputRefused?.({ route: 'reply-suggestion', reason })
  return null
}
