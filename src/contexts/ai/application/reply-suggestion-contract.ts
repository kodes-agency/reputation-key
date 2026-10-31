import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { ConcreteReplyLanguageResult } from '#/shared/ai-reply-language-verifier'
import type { ReplyTone } from '#/shared/ai-reply-template-catalogue'
import type {
  EvaluatedReviewLanguage,
  ReplyTemplateLanguageGroup,
} from '#/shared/ai-review-language-catalogue'
import type { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/ai-personalized-reply-contract'
import type { REPLY_DRAFTING_V2_VERSIONS } from '#/shared/reply-drafting-v2-schema'
import type { ReplyDraftingV2Frame } from '#/shared/reply-drafting-v2-frame'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import type { AiAuthorizationPort } from './ports/ai-authorization.port'
import type { AiControlPort } from './ports/ai-control.port'
import type { AiInferencePort } from './ports/ai-inference.port'
import type { AiOperationStorePort } from './ports/ai-operation-store.port'
import type { AiOutputStorePort } from './ports/ai-output-store.port'
import type { AiAdmissionPort } from './ports/ai-admission.port'
import type { PropertyProcessingProfilePort } from './ports/property-processing-profile.port'

export type GenerateReplySuggestionInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  actorUserId: UserId
  tone: ReplyTone
  targetLanguage:
    Readonly<{ kind: 'property_default' }> | Readonly<{ kind: 'review_language' }>
  idempotencyKey: string
  intent?: 'explicit' | 'background'
  trigger?: 'draft' | 'try_again' | 'shorter' | 'tone'
  /** Trusted in-process observer, never accepted from request JSON. */
  onProgress?: import('#/shared/reply-drafting-progress').ReplyDraftingProgressSink
  onIdentity?: (
    identity: import('./reply-drafting-requests').DraftingRequestIdentity,
  ) => void
  /** Explicitly request the governed local catalogue without AI admission or execution. */
  templateOnly?: boolean
  variation?: number
  length?: 'standard' | 'short'
  maxWords?: number
  expectedSourceEpoch: number
  expectedSourceRevision: number
  expectedBaseReplyStateRevision: number
}>

export type GenerateReplySuggestionResult =
  | Readonly<{
      status: 'ready'
      measurementGenerationId?: string
      profileVersion:
        | typeof AI_PERSONALIZED_REPLY_PROFILE_VERSION
        | typeof REPLY_DRAFTING_V2_VERSIONS.profile
      mainPoint?: readonly number[]
      case?: string
      replyText: string
      provenanceToken: string
      expiresAtEpochMillis: number
      baseReplyStateRevision: number
      concreteLanguageTag: string
    }>
  | Readonly<{
      status: 'fallback'
      /** Local, deterministic copy — never represented as provider-generated. */
      kind: 'local_safe_template'
      reason:
        // The manager explicitly asked for the governed catalogue template.
        | 'template_requested'
        // The target language has catalogue templates but no personalized
        // drafting profile, so a template is the only draft available.
        | 'language_not_personalized'
        | 'language_undetermined'
        | 'no_review_text'
      languageSource: 'explicit' | 'property_default'
      replyText: string
      concreteLanguageTag: string
    }>
  | Readonly<{
      status: 'unavailable'
      code:
        | 'not_authorized'
        // AI is enabled, under a notice no longer in force. Drafting resumes
        // once an AccountAdmin confirms the served notice.
        | 'consent_renewal_required'
        | 'source_changed'
        // A language exists in the catalogue but has no reply templates.
        | 'language_not_supported'
        // The property has no configured default, or the persisted value no
        // longer resolves through the pinned concrete-language catalogue.
        | 'target_language_unavailable'
        | 'brand_profile_unavailable'
        | 'brand_profile_changed'
        | 'voice_changed'
        | 'policy_unavailable'
        | 'completed_without_delivery'
        | 'provider_unavailable'
        // Our own interactive AI capacity is in use; retry at the given time.
        | 'busy'
      retryAfterEpochMillis: number | null
    }>

export type GenerateReplySuggestionDependencies = Readonly<{
  logger?: Pick<import('#/shared/domain/logger.port').LoggerPort, 'warn'>
  measurements?: Readonly<{
    record(
      input: import('#/shared/domain/draft-measurement').DraftGenerationMeasurement,
    ): Promise<string | null>
  }>
  authorization: AiAuthorizationPort
  control: AiControlPort
  inference: AiInferencePort
  operations: AiOperationStorePort
  outputs: AiOutputStorePort
  admission: AiAdmissionPort
  reviewSources: AiReviewSourcePort
  processingProfiles: PropertyProcessingProfilePort
  propertyReplyLanguages: Readonly<{
    readDefaultReplyLanguage(
      input: Readonly<{
        organizationId: OrganizationId
        propertyId: PropertyId
      }>,
    ): Promise<string | null>
  }>
  replyBrandProfiles: Pick<
    PortalAiReplyBrandProfilePublicApi,
    'readCurrentAiReplyBrandProfile'
  >
  replyVoices?: Readonly<{
    resolveV2Frame?(
      input: Readonly<{
        organizationId: OrganizationId
        propertyId: PropertyId
        reviewId: ReviewId
        languageGroup: string
        generationSeed: string
        nowEpochMillis: number
      }>,
    ): Promise<ReplyDraftingV2Frame | null>
    resolveLocalFrame(
      input: Readonly<{
        organizationId: OrganizationId
        propertyId: PropertyId
        reviewId: ReviewId
        languageGroup: ReplyTemplateLanguageGroup
      }>,
    ): Promise<Readonly<{
      prefix: string
      suffix: string
      voiceDigest: string
      reviewerDisplayName: string | null
      contact: string | null
      signerName: string | null
      signerTitle: string | null
      businessName: string
    }> | null>
  }>
  resolveReplyLanguage(
    input: Readonly<{
      text: string
      evaluatedLanguage: EvaluatedReviewLanguage
    }>,
  ): Promise<ConcreteReplyLanguageResult>
  nowEpochMillis: () => number
  /** Injected for tests; defaults to a timer. */
  sleep?: (milliseconds: number) => Promise<void>
}>
