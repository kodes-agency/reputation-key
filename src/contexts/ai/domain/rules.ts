import { err, ok, type Result } from '#/shared/domain'
import { isIsoCountryCode } from '#/shared/domain/iso-country-codes'
import { isValidIanaTimezone } from '#/shared/domain/timezones'
import { aiError, type AiError } from './errors'
import type {
  AiExecutionBinding,
  AiOperationIdentity,
  AiPrivateBetaPolicy,
  AiProcessingCellResult,
} from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const TOKEN = /^[a-z][a-z0-9._/-]{0,149}$/
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
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    routingPolicyVersion: 1,
  }
}

const POLICY_KEYS = [
  'version',
  'region',
  'manualPublicationRequired',
  'initialBundle',
  'capabilities',
  'roles',
  'routes',
  'sourceClasses',
  'outputClasses',
  'retentionPolicies',
  'releaseGates',
] as const

const ROW_KEYS = {
  capability: [
    'id',
    'platformCapability',
    'permission',
    'actorKind',
    'routeId',
    'runtimeProfileVersion',
    'requires',
  ],
  role: ['id', 'permissions'],
  route: ['id', 'sourceClassId', 'outputClassId', 'retentionPolicyId'],
  sourceClass: ['id', 'containsRawReviewContent'],
  outputClass: ['id', 'durable'],
  retention: ['id', 'duration'],
  gate: ['id', 'stage', 'owner', 'contentClass'],
} as const

function asRows(
  value: unknown,
  kind: keyof typeof ROW_KEYS,
): Result<ReadonlyArray<Readonly<Record<string, unknown>>>, AiError> {
  if (!Array.isArray(value) || value.length === 0)
    return invalid(`${kind} rows are required`)
  const rows: Array<Readonly<Record<string, unknown>>> = []
  for (const row of value) {
    if (!isRecord(row) || !exactKeys(row, ROW_KEYS[kind])) {
      return invalid(`${kind} row has unknown or missing fields`)
    }
    if (!nonEmptyString(row.id, 100) || !TOKEN.test(row.id)) {
      return invalid(`${kind} row has an invalid ID`)
    }
    rows.push(row)
  }
  return ok(rows)
}

function validateSortedUnique(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  label: string,
): Result<void, AiError> {
  const ids = rows.map((row) => String(row.id))
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) return invalid(`duplicate ${label} ID ${id}`)
    seen.add(id)
  }
  const sorted = [...ids].sort()
  if (!ids.every((id, index) => id === sorted[index])) {
    return invalid(`${label} rows must use sorted ${label} IDs`)
  }
  return ok(undefined)
}

function stringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((entry) => nonEmptyString(entry, 150))
}

export function parseAiPrivateBetaPolicy(
  value: unknown,
): Result<AiPrivateBetaPolicy, AiError> {
  if (!isRecord(value)) return invalid('policy must be an object')
  if (!exactKeys(value, POLICY_KEYS)) return invalid('unknown policy field')
  if (
    value.version !== 'ai-private-beta-policy-v1' ||
    value.region !== 'global' ||
    value.manualPublicationRequired !== true ||
    !stringArray(value.initialBundle)
  ) {
    return invalid('policy root constants are invalid')
  }

  const capabilities = asRows(value.capabilities, 'capability')
  const roles = asRows(value.roles, 'role')
  const routes = asRows(value.routes, 'route')
  const sourceClasses = asRows(value.sourceClasses, 'sourceClass')
  const outputClasses = asRows(value.outputClasses, 'outputClass')
  const retentionPolicies = asRows(value.retentionPolicies, 'retention')
  const releaseGates = asRows(value.releaseGates, 'gate')
  if (capabilities.isErr()) return err(capabilities.error)
  if (roles.isErr()) return err(roles.error)
  if (routes.isErr()) return err(routes.error)
  if (sourceClasses.isErr()) return err(sourceClasses.error)
  if (outputClasses.isErr()) return err(outputClasses.error)
  if (retentionPolicies.isErr()) return err(retentionPolicies.error)
  if (releaseGates.isErr()) return err(releaseGates.error)

  for (const [rowsToCheck, label] of [
    [capabilities.value, 'capability'],
    [roles.value, 'role'],
    [routes.value, 'route'],
    [sourceClasses.value, 'sourceClass'],
    [outputClasses.value, 'outputClass'],
    [retentionPolicies.value, 'retention'],
    [releaseGates.value, 'releaseGate'],
  ] as const) {
    const result = validateSortedUnique(rowsToCheck, label)
    if (result.isErr()) return err(result.error)
  }

  const routeIds = new Set(routes.value.map((row) => String(row.id)))
  const sourceIds = new Set(sourceClasses.value.map((row) => String(row.id)))
  const outputIds = new Set(outputClasses.value.map((row) => String(row.id)))
  const retentionIds = new Set(retentionPolicies.value.map((row) => String(row.id)))
  const capabilityIds = new Set(capabilities.value.map((row) => String(row.id)))
  const consumedRoutes = new Set<string>()

  for (const row of capabilities.value) {
    if (
      !nonEmptyString(row.platformCapability, 100) ||
      !nonEmptyString(row.permission, 100) ||
      !nonEmptyString(row.runtimeProfileVersion, 100) ||
      (row.actorKind !== 'manager' && row.actorKind !== 'worker') ||
      !nonEmptyString(row.routeId, 100) ||
      !stringArray(row.requires)
    ) {
      return invalid(`capability ${String(row.id)} has invalid fields`)
    }
    if (!routeIds.has(row.routeId)) {
      return invalid(`dangling route reference ${row.routeId}`)
    }
    consumedRoutes.add(row.routeId)
    for (const dependency of row.requires) {
      if (!capabilityIds.has(dependency)) {
        return invalid(`dangling capability reference ${dependency}`)
      }
    }
  }
  for (const routeId of routeIds) {
    if (!consumedRoutes.has(routeId)) return invalid(`unconsumed route ${routeId}`)
  }

  for (const row of routes.value) {
    if (!sourceIds.has(String(row.sourceClassId))) {
      return invalid(`dangling source class reference ${String(row.sourceClassId)}`)
    }
    if (!outputIds.has(String(row.outputClassId))) {
      return invalid(`dangling output class reference ${String(row.outputClassId)}`)
    }
    if (!retentionIds.has(String(row.retentionPolicyId))) {
      return invalid(`dangling retention reference ${String(row.retentionPolicyId)}`)
    }
  }

  for (const row of roles.value) {
    if (!stringArray(row.permissions)) return invalid(`role ${String(row.id)} is invalid`)
  }
  for (const row of sourceClasses.value) {
    if (typeof row.containsRawReviewContent !== 'boolean') {
      return invalid(`source class ${String(row.id)} is invalid`)
    }
  }
  for (const row of outputClasses.value) {
    if (typeof row.durable !== 'boolean')
      return invalid(`output class ${String(row.id)} is invalid`)
  }
  for (const row of retentionPolicies.value) {
    if (row.duration !== 'response_lifetime' && row.duration !== '24_months') {
      return invalid(`retention ${String(row.id)} is invalid`)
    }
  }
  for (const row of releaseGates.value) {
    if (
      (row.stage !== 'candidate' && row.stage !== 'activation') ||
      !nonEmptyString(row.owner, 64) ||
      row.contentClass !== 'content_free'
    ) {
      return invalid(`release gate ${String(row.id)} is invalid or has no owner`)
    }
  }

  const initialIds = [...value.initialBundle]
  if (
    initialIds.length !== capabilityIds.size ||
    !initialIds.every((id, index) => id === [...capabilityIds].sort()[index])
  ) {
    return invalid('initial bundle must contain every capability in sorted order')
  }

  return ok(value as AiPrivateBetaPolicy)
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
  if (!isRecord(value) || !exactKeys(value, BINDING_KEYS) || !commonBindingValid(value)) {
    return invalid('AI execution binding has unknown, missing, or invalid common fields')
  }
  if (!isRecord(value.capabilityFence)) return invalid('capability fence is invalid')

  const capability = value.capabilityFence.capability
  if (capability === 'review_analysis') {
    if (
      !exactKeys(value.capabilityFence, ['capability', 'reviewAnalysisEpoch']) ||
      !isPositiveSafeInteger(value.capabilityFence.reviewAnalysisEpoch) ||
      !nonEmptyString(value.evaluatedLanguage, 35) ||
      !isPositiveSafeInteger(value.sourceRevision) ||
      !isNonnegativeSafeInteger(value.reviewedAtEpochMillis) ||
      !nonEmptyString(value.aiSubjectHmacKeyVersion, 100) ||
      value.operationProfileVersion !== 'review-analysis-v1' ||
      value.capabilityRuntimeProfileVersion !== 'review-analysis-runtime-v1' ||
      !allNull(value, [
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
    ) {
      return invalid('analysis binding is cross-wired or incomplete')
    }
  } else if (capability === 'reply_drafting') {
    const concrete = value.concreteReplyLanguage
    if (
      !exactKeys(value.capabilityFence, [
        'capability',
        'replyDraftingEpoch',
        'baseReplyStateRevision',
      ]) ||
      !isPositiveSafeInteger(value.capabilityFence.replyDraftingEpoch) ||
      !isNonnegativeSafeInteger(value.capabilityFence.baseReplyStateRevision) ||
      !nonEmptyString(value.evaluatedLanguage, 35) ||
      !isRecord(concrete) ||
      !exactKeys(concrete, ['tag', 'templateGroup']) ||
      !nonEmptyString(concrete.tag, 35) ||
      !nonEmptyString(concrete.templateGroup, 64) ||
      !isPositiveSafeInteger(value.sourceRevision) ||
      !isNonnegativeSafeInteger(value.reviewedAtEpochMillis) ||
      value.aiSubjectHmacKeyVersion !== null ||
      !nonEmptyString(value.outputLeakageProfileVersion, 100) ||
      !nonEmptyString(value.replyTemplateCatalogueVersion, 100) ||
      value.operationProfileVersion !== 'reply-suggestion-v1' ||
      value.capabilityRuntimeProfileVersion !== 'reply-drafting-runtime-v1' ||
      [
        value.languageCatalogueDigest,
        value.replyLanguageVerifierDigest,
        value.languageScriptConsistencyDigest,
        value.zhOrthographyVerifierDigest,
        value.outputLeakageProfileDigest,
        value.replyTemplateCatalogueDigest,
      ].some((digest) => typeof digest !== 'string' || !SHA256.test(digest))
    ) {
      return invalid('reply binding is cross-wired or incomplete')
    }
  } else if (capability === 'property_trends') {
    if (
      !exactKeys(value.capabilityFence, [
        'capability',
        'reviewAnalysisEpoch',
        'propertyTrendsEpoch',
      ]) ||
      !isPositiveSafeInteger(value.capabilityFence.reviewAnalysisEpoch) ||
      !isPositiveSafeInteger(value.capabilityFence.propertyTrendsEpoch) ||
      value.operationProfileVersion !== 'property-trend-v1' ||
      value.capabilityRuntimeProfileVersion !== 'property-trends-runtime-v1' ||
      !allNull(value, [
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
    ) {
      return invalid('trend binding is cross-wired or incomplete')
    }
  } else {
    return invalid('unknown capability fence')
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
