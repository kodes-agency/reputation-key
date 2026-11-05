import { err, ok, type Result } from '#/shared/domain'
import { isIsoCountryCode } from '#/shared/domain/iso-country-codes'
import { isValidIanaTimezone } from '#/shared/domain/timezones'
import { aiError, type AiError } from './errors'
import type {
  AiExecutionBinding,
  AiOperationIdentity,
  AiProcessingCellResult,
} from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const LOCAL_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function nonEmptyString(value: unknown, maxBytes = 255): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maxBytes &&
    !hasControlCharacter(value)
  )
}

function invalid(message: string): Result<never, AiError> {
  return err(aiError('invalid_request', message))
}

export function resolveAiProcessingCell(
  input: Readonly<{
    countryCode: string
    timezone: string
  }>,
): AiProcessingCellResult {
  if (!isIsoCountryCode(input.countryCode) || !isValidIanaTimezone(input.timezone)) {
    return { status: 'policy_unavailable' }
  }
  return {
    status: 'available',
    processingRegion: 'global',
    providerDeploymentProfileVersion: 'private-beta-global-v2',
    routingPolicyVersion: 1,
  }
}

const BINDING_KEYS = [
  'authorizationLineageId',
  'noticeVersion',
  'noticeDigest',
  'capabilityFence',
  'sourceEpoch',
  'evaluatedLanguage',
  'concreteReplyLanguage',
  'languageCatalogueDigest',
  'replyLanguageVerifierDigest',
  'languageScriptConsistencyDigest',
  'zhOrthographyVerifierDigest',
  'sourceRevision',
  'reviewedAtEpochMillis',
  'propertyProfileVersion',
  'replyBrandProfileVersion',
  'replyBrandDisplayNameDigest',
  'routingPolicyVersion',
  'sourcePolicyId',
  'sourceCanonicalizerDigest',
  'redactionProfileVersion',
  'outputLeakageProfileVersion',
  'outputLeakageProfileDigest',
  'replyTemplateCatalogueVersion',
  'replyTemplateCatalogueDigest',
  'providerDeploymentProfileVersion',
  'operationProfileVersion',
  'capabilityRuntimeProfileVersion',
  'aiSubjectHmacKeyVersion',
  'stopFence',
] as const

function validDigestOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'string' && SHA256.test(value))
}

function validStopFence(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = [
    'globalControlId',
    'globalGeneration',
    'providerControlId',
    'providerGeneration',
    'capabilityControlId',
    'capabilityGeneration',
  ]
  return (
    exactKeys(value, keys) &&
    UUID.test(String(value.globalControlId)) &&
    isPositiveSafeInteger(value.globalGeneration) &&
    UUID.test(String(value.providerControlId)) &&
    isPositiveSafeInteger(value.providerGeneration) &&
    UUID.test(String(value.capabilityControlId)) &&
    isPositiveSafeInteger(value.capabilityGeneration)
  )
}

// Split in two halves, not extracted into per-field helpers. The contract is a
// flat transcription of BINDING_KEYS and its review value is that a reader sees
// every field beside that array — scattering it would cost exactly that. The
// halves stay adjacent and in the original order, so the whole contract is
// still read top to bottom; only the `&&` count per function drops.
//
// The reply-brand pair invariant is the one genuinely compound clause, so it is
// named rather than left inline.
function replyBrandPairValid(value: Readonly<Record<string, unknown>>): boolean {
  const versionAbsent = value.replyBrandProfileVersion === null
  const digestAbsent = value.replyBrandDisplayNameDigest === null
  if (versionAbsent && digestAbsent) return true
  return (
    isPositiveSafeInteger(value.replyBrandProfileVersion) &&
    typeof value.replyBrandDisplayNameDigest === 'string' &&
    SHA256.test(value.replyBrandDisplayNameDigest)
  )
}

function commonBindingIdentityValid(value: Readonly<Record<string, unknown>>): boolean {
  return (
    UUID.test(String(value.authorizationLineageId)) &&
    nonEmptyString(value.noticeVersion, 100) &&
    typeof value.noticeDigest === 'string' &&
    SHA256.test(value.noticeDigest) &&
    // 0-based source epoch (drizzle/0060): a property that has never been edited
    // sits at 0. propertyProfileVersion and routingPolicyVersion below are
    // genuinely 1-based.
    isNonnegativeSafeInteger(value.sourceEpoch) &&
    isPositiveSafeInteger(value.propertyProfileVersion) &&
    (value.replyBrandProfileVersion === null ||
      isPositiveSafeInteger(value.replyBrandProfileVersion)) &&
    validDigestOrNull(value.replyBrandDisplayNameDigest) &&
    replyBrandPairValid(value) &&
    isPositiveSafeInteger(value.routingPolicyVersion) &&
    nonEmptyString(value.sourcePolicyId, 150)
  )
}

function commonBindingProfileValid(value: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof value.sourceCanonicalizerDigest === 'string' &&
    SHA256.test(value.sourceCanonicalizerDigest) &&
    nonEmptyString(value.redactionProfileVersion, 100) &&
    nonEmptyString(value.providerDeploymentProfileVersion, 100) &&
    nonEmptyString(value.operationProfileVersion, 100) &&
    nonEmptyString(value.capabilityRuntimeProfileVersion, 100) &&
    validDigestOrNull(value.languageCatalogueDigest) &&
    validDigestOrNull(value.replyLanguageVerifierDigest) &&
    validDigestOrNull(value.languageScriptConsistencyDigest) &&
    validDigestOrNull(value.zhOrthographyVerifierDigest) &&
    validDigestOrNull(value.outputLeakageProfileDigest) &&
    validDigestOrNull(value.replyTemplateCatalogueDigest) &&
    validStopFence(value.stopFence)
  )
}

function commonBindingValid(value: Readonly<Record<string, unknown>>): boolean {
  return commonBindingIdentityValid(value) && commonBindingProfileValid(value)
}

function allNull(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
): boolean {
  return keys.every((key) => value[key] === null)
}

/**
 * The operation profile and the runtime profile an analysis binding names go
 * together: the two live generations, and v3 beside them (dark until its
 * activation slice selects it, `review-analysis-runtime-v2`).
 */
function analysisProfilePairValid(value: Readonly<Record<string, unknown>>): boolean {
  return (
    ((value.operationProfileVersion === 'review-analysis-v1' ||
      value.operationProfileVersion === 'review-analysis-v2') &&
      value.capabilityRuntimeProfileVersion === 'review-analysis-runtime-v1') ||
    (value.operationProfileVersion === 'review-analysis-v3' &&
      value.capabilityRuntimeProfileVersion === 'review-analysis-runtime-v2')
  )
}

function analysisBindingValid(
  value: Readonly<Record<string, unknown>>,
  fence: Readonly<Record<string, unknown>>,
): boolean {
  return (
    exactKeys(fence, ['capability', 'reviewAnalysisEpoch']) &&
    isPositiveSafeInteger(fence.reviewAnalysisEpoch) &&
    nonEmptyString(value.evaluatedLanguage, 35) &&
    isPositiveSafeInteger(value.sourceRevision) &&
    isNonnegativeSafeInteger(value.reviewedAtEpochMillis) &&
    nonEmptyString(value.aiSubjectHmacKeyVersion, 100) &&
    analysisProfilePairValid(value) &&
    allNull(value, [
      'concreteReplyLanguage',
      'replyLanguageVerifierDigest',
      'languageScriptConsistencyDigest',
      'zhOrthographyVerifierDigest',
      'outputLeakageProfileVersion',
      'outputLeakageProfileDigest',
      'replyTemplateCatalogueVersion',
      'replyTemplateCatalogueDigest',
      'replyBrandProfileVersion',
      'replyBrandDisplayNameDigest',
    ])
  )
}

function replyBindingDigestsValid(value: Readonly<Record<string, unknown>>): boolean {
  return [
    value.languageCatalogueDigest,
    value.replyLanguageVerifierDigest,
    value.languageScriptConsistencyDigest,
    value.zhOrthographyVerifierDigest,
    value.outputLeakageProfileDigest,
    value.replyTemplateCatalogueDigest,
  ].every((digest) => typeof digest === 'string' && SHA256.test(digest))
}

function replyBindingValid(
  value: Readonly<Record<string, unknown>>,
  fence: Readonly<Record<string, unknown>>,
): boolean {
  const concrete = value.concreteReplyLanguage
  return (
    exactKeys(fence, ['capability', 'replyDraftingEpoch', 'baseReplyStateRevision']) &&
    isPositiveSafeInteger(fence.replyDraftingEpoch) &&
    isNonnegativeSafeInteger(fence.baseReplyStateRevision) &&
    nonEmptyString(value.evaluatedLanguage, 35) &&
    isRecord(concrete) &&
    exactKeys(concrete, ['tag', 'templateGroup']) &&
    nonEmptyString(concrete.tag, 35) &&
    nonEmptyString(concrete.templateGroup, 64) &&
    isPositiveSafeInteger(value.sourceRevision) &&
    isNonnegativeSafeInteger(value.reviewedAtEpochMillis) &&
    value.aiSubjectHmacKeyVersion === null &&
    nonEmptyString(value.outputLeakageProfileVersion, 100) &&
    nonEmptyString(value.replyTemplateCatalogueVersion, 100) &&
    // Each reply version binds its own runtime and payload contract.
    replyProfilePairValid(value) &&
    replyBindingDigestsValid(value)
  )
}

function trendBindingValid(
  value: Readonly<Record<string, unknown>>,
  fence: Readonly<Record<string, unknown>>,
): boolean {
  return (
    exactKeys(fence, ['capability', 'reviewAnalysisEpoch', 'propertyTrendsEpoch']) &&
    isPositiveSafeInteger(fence.reviewAnalysisEpoch) &&
    isPositiveSafeInteger(fence.propertyTrendsEpoch) &&
    value.operationProfileVersion === 'property-trend-v1' &&
    value.capabilityRuntimeProfileVersion === 'property-trends-runtime-v1' &&
    allNull(value, [
      'evaluatedLanguage',
      'concreteReplyLanguage',
      'languageCatalogueDigest',
      'replyLanguageVerifierDigest',
      'languageScriptConsistencyDigest',
      'zhOrthographyVerifierDigest',
      'sourceRevision',
      'reviewedAtEpochMillis',
      'outputLeakageProfileVersion',
      'outputLeakageProfileDigest',
      'replyTemplateCatalogueVersion',
      'replyTemplateCatalogueDigest',
      'replyBrandProfileVersion',
      'replyBrandDisplayNameDigest',
      'aiSubjectHmacKeyVersion',
    ])
  )
}

export function parseAiExecutionBinding(
  value: unknown,
): Result<AiExecutionBinding, AiError> {
  // Rows and signed descriptors created before Brand-grounded Reply Drafting
  // have neither field. Decode that exact legacy pair as null while rejecting
  // a partially present or otherwise unknown shape.
  if (
    isRecord(value) &&
    !Object.hasOwn(value, 'replyBrandProfileVersion') &&
    !Object.hasOwn(value, 'replyBrandDisplayNameDigest')
  ) {
    value = {
      ...value,
      replyBrandProfileVersion: null,
      replyBrandDisplayNameDigest: null,
    }
  }
  if (!isRecord(value) || !bindingKeysValid(value) || !commonBindingValid(value)) {
    return invalid('AI execution binding has unknown, missing, or invalid common fields')
  }
  if (!isRecord(value.capabilityFence)) return invalid('capability fence is invalid')

  const capability = value.capabilityFence.capability
  const valid =
    capability === 'review_analysis'
      ? analysisBindingValid(value, value.capabilityFence)
      : capability === 'reply_drafting'
        ? replyBindingValid(value, value.capabilityFence)
        : capability === 'property_trends'
          ? trendBindingValid(value, value.capabilityFence)
          : null
  if (valid === null) return invalid('unknown capability fence')
  if (!valid) {
    return invalid(
      capability === 'review_analysis'
        ? 'analysis binding is cross-wired or incomplete'
        : capability === 'reply_drafting'
          ? 'reply binding is cross-wired or incomplete'
          : 'trend binding is cross-wired or incomplete',
    )
  }
  return ok(value as AiExecutionBinding)
}

const OPERATION_KEYS = {
  analysis: [
    'command',
    'organizationId',
    'propertyId',
    'actorId',
    'systemPrincipal',
    'reviewId',
    'originEventId',
    'subjectHmac',
    'subjectHmacKeyVersion',
    'sourceEpoch',
    'sourceRevision',
    'reviewedAtEpochMillis',
    'analysisSequence',
  ],
  reply: [
    'command',
    'organizationId',
    'propertyId',
    'actorId',
    'systemPrincipal',
    'reviewId',
    'sourceEpoch',
    'sourceRevision',
    'reviewedAtEpochMillis',
    'tone',
    'baseReplyStateRevision',
  ],
  trend: [
    'command',
    'organizationId',
    'propertyId',
    'actorId',
    'systemPrincipal',
    'sourceEpoch',
    'dueLocalDate',
    'terminalAnalysisSequence',
    'aggregateRevision',
  ],
} as const

export function createAiOperationIdentity(
  value: unknown,
): Result<AiOperationIdentity, AiError> {
  if (!isRecord(value) || typeof value.command !== 'string') {
    return invalid('operation identity must be an object with a command')
  }
  if (!Object.hasOwn(OPERATION_KEYS, value.command)) {
    return invalid('operation command is not supported')
  }
  const command = value.command as keyof typeof OPERATION_KEYS
  if (!exactKeys(value, OPERATION_KEYS[command])) {
    return invalid(`${command} identity has missing, extra, or cross-branch fields`)
  }

  if (command === 'analysis') {
    if (
      !nonEmptyString(value.organizationId) ||
      !UUID.test(String(value.propertyId)) ||
      value.actorId !== null ||
      value.systemPrincipal !== 'review_event_consumer' ||
      !UUID.test(String(value.reviewId)) ||
      !UUID.test(String(value.originEventId)) ||
      typeof value.subjectHmac !== 'string' ||
      !SHA256.test(value.subjectHmac) ||
      !nonEmptyString(value.subjectHmacKeyVersion, 100) ||
      // 0-based source epoch; sourceRevision and analysisSequence stay 1-based.
      !isNonnegativeSafeInteger(value.sourceEpoch) ||
      !isPositiveSafeInteger(value.sourceRevision) ||
      !isNonnegativeSafeInteger(value.reviewedAtEpochMillis) ||
      !isPositiveSafeInteger(value.analysisSequence)
    ) {
      return invalid('analysis identity is invalid')
    }
    return ok({
      subjectKind: 'property',
      command: 'analysis',
      capability: 'review_analysis',
      organizationId: value.organizationId,
      propertyId: value.propertyId as string,
      actorId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: value.reviewId as string,
      originEventId: value.originEventId as string,
      subjectHmac: value.subjectHmac,
      subjectHmacKeyVersion: value.subjectHmacKeyVersion,
      sourceEpoch: value.sourceEpoch,
      sourceRevision: value.sourceRevision,
      reviewedAtEpochMillis: value.reviewedAtEpochMillis,
      analysisSequence: value.analysisSequence,
    })
  }

  if (command === 'reply') {
    if (
      !nonEmptyString(value.organizationId) ||
      !UUID.test(String(value.propertyId)) ||
      !nonEmptyString(value.actorId) ||
      value.systemPrincipal !== null ||
      !UUID.test(String(value.reviewId)) ||
      // 0-based source epoch; this is the site that rejected the owner's first
      // reply suggestion on a freshly imported property.
      !isNonnegativeSafeInteger(value.sourceEpoch) ||
      !isPositiveSafeInteger(value.sourceRevision) ||
      !isNonnegativeSafeInteger(value.reviewedAtEpochMillis) ||
      !['professional', 'friendly', 'casual'].includes(String(value.tone)) ||
      !isNonnegativeSafeInteger(value.baseReplyStateRevision)
    ) {
      return invalid('reply identity is invalid')
    }
    return ok({
      subjectKind: 'property',
      command: 'reply',
      capability: 'reply_drafting',
      organizationId: value.organizationId,
      propertyId: value.propertyId as string,
      actorId: value.actorId,
      systemPrincipal: null,
      reviewId: value.reviewId as string,
      sourceEpoch: value.sourceEpoch,
      sourceRevision: value.sourceRevision,
      reviewedAtEpochMillis: value.reviewedAtEpochMillis,
      tone: value.tone as 'professional' | 'friendly' | 'casual',
      baseReplyStateRevision: value.baseReplyStateRevision,
    })
  }

  if (command === 'trend') {
    if (
      !nonEmptyString(value.organizationId) ||
      !UUID.test(String(value.propertyId)) ||
      value.actorId !== null ||
      value.systemPrincipal !== 'property_trend_coordinator' ||
      // 0-based source epoch (drizzle/0060).
      !isNonnegativeSafeInteger(value.sourceEpoch) ||
      typeof value.dueLocalDate !== 'string' ||
      !LOCAL_DATE.test(value.dueLocalDate) ||
      !isNonnegativeSafeInteger(value.terminalAnalysisSequence) ||
      !isNonnegativeSafeInteger(value.aggregateRevision)
    ) {
      return invalid('trend identity is invalid')
    }
    return ok({
      subjectKind: 'property',
      command: 'trend',
      capability: 'property_trends',
      organizationId: value.organizationId,
      propertyId: value.propertyId as string,
      actorId: null,
      systemPrincipal: 'property_trend_coordinator',
      sourceEpoch: value.sourceEpoch,
      dueLocalDate: value.dueLocalDate,
      terminalAnalysisSequence: value.terminalAnalysisSequence,
      aggregateRevision: value.aggregateRevision,
    })
  }

  return invalid('operation command is not supported')
}

import { isReplyDraftingV2Binding } from '#/shared/domain/reply-drafting-v2'

function replyProfilePairValid(value: Readonly<Record<string, unknown>>): boolean {
  if (value.operationProfileVersion === 'reply-suggestion-v1')
    return (
      value.capabilityRuntimeProfileVersion === 'reply-drafting-runtime-v1' &&
      value.replyDraftingV2 === undefined
    )
  return (
    value.operationProfileVersion === 'reply-suggestion-v2' &&
    value.capabilityRuntimeProfileVersion === 'reply-drafting-runtime-v2' &&
    isReplyDraftingV2Binding(value.replyDraftingV2)
  )
}

function bindingKeysValid(value: Readonly<Record<string, unknown>>): boolean {
  const keys =
    value.replyDraftingV2 === undefined
      ? BINDING_KEYS
      : [...BINDING_KEYS, 'replyDraftingV2']
  return (
    exactKeys(value, keys) &&
    (value.replyDraftingV2 === undefined ||
      value.operationProfileVersion === 'reply-suggestion-v2')
  )
}
