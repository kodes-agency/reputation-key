import {
  AI_RUNTIME_CAPABILITIES_V1,
  resolveAiRuntimeCapabilitySet,
} from '#/shared/ai-runtime-capability-contract'
import type { MerchantAiPurpose } from '#/shared/domain/merchant-ai-capability'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
  type MerchantAiSnapshot,
  type MerchantAiState,
} from '../../domain/merchant-ai-authorization'
import type { MerchantAiDecisionDeferralReader } from './merchant-ai-decision-deferral'

export {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
} from '../../domain/merchant-ai-authorization'
export type {
  CurrentMerchantAiCapability,
  MerchantAiCapabilityEpochs,
  MerchantAiSnapshot,
  MerchantAiState,
} from '../../domain/merchant-ai-authorization'

export type MerchantAiMutationInput = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
  idempotencyKey: string
  expectedStateVersion: number
  operation: 'enable' | 'change' | 'revoke'
  state: Extract<MerchantAiState, 'enabled' | 'revoked'>
  capabilities: ReadonlyArray<MerchantAiCapability>
  reasonCode: string
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  routingPolicyVersion: number
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  redactionProfileFamily: string
  now: Date
  /** The consent ceremony that asked for this transition; not part of replay identity. */
  ceremonyId: string
}>

export type MerchantAiRestoreResetInput = Readonly<{
  organizationId: string
  propertyId: string
  idempotencyKey: string
  expectedStateVersion: number
  reasonCode: 'restore_safety'
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  routingPolicyVersion: number
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  redactionProfileFamily: string
  now: Date
}>

/** Most Properties one consent ceremony may cover: one import batch. */
export const MAX_MERCHANT_AI_CEREMONY_PROPERTIES = 100

export type MerchantAiConsentOutcome = 'enabled' | 'changed' | 'unchanged'

export type MerchantAiPropertyConsentResult = Readonly<{
  propertyId: string
  outcome: MerchantAiConsentOutcome
  snapshot: MerchantAiSnapshot
}>

/**
 * One consent ceremony over several Properties, validated and authorized by the
 * use case. The store applies it in one transaction.
 */
export type MerchantAiConsentCeremonyInput = Readonly<{
  organizationId: string
  actorUserId: string
  /** Unique, lowercase, in the caller's order. */
  propertyIds: ReadonlyArray<string>
  /** Normalized: unique and in catalogue order. */
  capabilities: ReadonlyArray<MerchantAiCapability>
  idempotencyKey: string
  reasonCode: string
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  routingPolicyVersion: number
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  redactionProfileFamily: string
  now: Date
  ceremonyId: string
}>

export type MerchantAiAuthorizationStore = Readonly<{
  getSnapshot(input: {
    organizationId: string
    propertyId: string
  }): Promise<MerchantAiSnapshot | null>
  /** An enable also deletes the Property's standing decision deferral, atomically. */
  mutate(input: MerchantAiMutationInput): Promise<MerchantAiSnapshot>
  /**
   * Atomic: every Property's enablement, evidence and outbox fact commit
   * together or not at all. Results follow `propertyIds` order. A retry with
   * the same idempotency key replays what the ceremony wrote; a Property it
   * left unchanged wrote nothing, so its replayed result is its live grant.
   */
  enableForProperties(
    input: MerchantAiConsentCeremonyInput,
  ): Promise<ReadonlyArray<MerchantAiPropertyConsentResult>>
  restoreReset(input: MerchantAiRestoreResetInput): Promise<MerchantAiSnapshot>
}>

export type MerchantAiAuthorizationStoreErrorCode =
  | 'idempotency_conflict'
  | 'version_conflict'
  | 'no_op'
  | 'invalid_transition'
  | 'membership_denied'
  | 'assignment_denied'
  | 'property_inactive'
  | 'invalid_capability_set'
  | 'runtime_mapping_unavailable'
  | 'restore_reset_denied'
  | 'invalid_record'

export class MerchantAiAuthorizationStoreError extends Error {
  constructor(
    readonly code: MerchantAiAuthorizationStoreErrorCode,
    message: string,
    /** The Property that refused, when a ceremony covers several. */
    readonly propertyId?: string,
  ) {
    super(message)
    this.name = 'MerchantAiAuthorizationStoreError'
  }
}

export type MerchantAiAuthorizationErrorCode =
  | 'capability_denied'
  | 'notice_mismatch'
  | 'unsupported_capability'
  | 'capabilities_required'
  | 'invalid_capability_dependency'
  | 'invalid_command'

export class MerchantAiAuthorizationError extends Error {
  constructor(
    readonly code: MerchantAiAuthorizationErrorCode,
    message: string,
    /** The Property that refused, when a ceremony covers several. */
    readonly propertyId?: string,
  ) {
    super(message)
    this.name = 'MerchantAiAuthorizationError'
  }
}

export type MerchantAiAuthorizationDeps = Readonly<{
  store: MerchantAiAuthorizationStore
  /** Standing "not now" decisions, surfaced on the snapshot read. */
  decisionDeferrals: MerchantAiDecisionDeferralReader
  authorizeManagement(input: {
    organizationId: string
    propertyId: string
    actorUserId: string
    now: Date
  }): Promise<boolean>
  authorize(input: {
    organizationId: string
    propertyId: string
    actorUserId: string
    capability: MerchantAiPurpose
    now: Date
  }): Promise<boolean>
  /** A multi-Property consent ceremony is an AccountAdmin decision. */
  isCurrentAccountAdmin(input: {
    organizationId: string
    actorUserId: string
  }): Promise<boolean>
  /**
   * Reserved hook for a future step-up proof. Consent does not call it: since
   * merchant-ai-notice-2026-09-15.v1 consent is the served notice, an explicit
   * acknowledgement of it, and the evidence row (decision 4 in
   * docs/plan/property-setup-exploration.md). A policy that brings a proof back
   * calls it from the consent commands in the same change that bumps the notice
   * and sets `requiresStepUp`.
   */
  verifyStepUp(input: {
    actorUserId: string
    organizationId: string
    proof: string
    now: Date
    requestHeaders?: Headers
  }): Promise<boolean>
  clock: () => Date
  /** Mints a consent ceremony id. */
  idGen: () => string
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  routingPolicyVersion: number
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  redactionProfileFamily: string
}>

export type MerchantAiReadInput = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
}>

export type MerchantAiCommandInput = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
  idempotencyKey: string
  expectedStateVersion: number
  /** Forwarded for the reserved step-up hook; consent does not read it. */
  requestHeaders?: Headers
  reasonCode: string
}>

/**
 * The notice the merchant read and acknowledged, as served to them. Consent is
 * refused unless it is exactly the notice the application serves now.
 */
export type MerchantAiNoticeAcknowledgement = Readonly<{
  noticeVersion: string
  noticeDigest: string
}>

/** A command that grants consent: enable or change. A revoke withdraws it. */
export type MerchantAiConsentCommandInput = MerchantAiCommandInput &
  Readonly<{ acknowledgement: MerchantAiNoticeAcknowledgement }>

/**
 * One consent ceremony for several Properties. Every Property ends enabled with
 * exactly `capabilities` under the served notice; one already there is left
 * unchanged.
 */
export type MerchantAiEnableForPropertiesInput = Readonly<{
  organizationId: string
  actorUserId: string
  propertyIds: ReadonlyArray<string>
  capabilities: ReadonlyArray<MerchantAiCapability>
  acknowledgement: MerchantAiNoticeAcknowledgement
  idempotencyKey: string
  reasonCode: string
  /** Forwarded for the reserved step-up hook; consent does not read it. */
  requestHeaders?: Headers
}>

export type MerchantAiAuthorization = ReturnType<typeof createMerchantAiAuthorization>

const RUNTIME_BY_CAPABILITY = new Map(
  AI_RUNTIME_CAPABILITIES_V1.map((entry) => [entry.capability, entry] as const),
)
const CURRENT_CAPABILITY_SET: ReadonlySet<string> = new Set(
  CURRENT_MERCHANT_AI_CAPABILITIES,
)
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function zeroCapabilityEpochs() {
  return Object.freeze({
    review_analysis: 0,
    reply_drafting: 0,
    property_trends: 0,
  })
}

function defaultSnapshot(
  deps: MerchantAiAuthorizationDeps,
  input: Pick<MerchantAiReadInput, 'organizationId' | 'propertyId'>,
): MerchantAiSnapshot {
  return {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    state: 'disabled',
    authorizationLineageId: null,
    capabilities: Object.freeze([]),
    capabilityRuntimeProfileVersions: Object.freeze({}),
    capabilityEpochs: zeroCapabilityEpochs(),
    authorizedSourceEpoch: 0,
    analysisStartSequence: 0,
    stateVersion: 0,
    noticeVersion: deps.noticeVersion,
    noticeDigest: deps.noticeDigest,
    sourcePolicyId: deps.sourcePolicyId,
    routingPolicyVersion: deps.routingPolicyVersion,
    processingRegion: 'global',
    providerDeploymentProfileVersion: deps.providerDeploymentProfileVersion,
    redactionProfileFamily: deps.redactionProfileFamily,
  }
}

function normalizeCapabilities(
  capabilities: ReadonlyArray<MerchantAiCapability>,
): ReadonlyArray<MerchantAiCapability> {
  for (const capability of capabilities) {
    if (!CURRENT_CAPABILITY_SET.has(capability)) {
      throw new MerchantAiAuthorizationError(
        'unsupported_capability',
        `Merchant AI capability '${capability}' is not available`,
      )
    }
  }
  if (new Set(capabilities).size !== capabilities.length) {
    throw new MerchantAiAuthorizationError(
      'unsupported_capability',
      'Merchant AI capabilities must be unique',
    )
  }
  const requested = new Set(capabilities)
  const normalized = CURRENT_MERCHANT_AI_CAPABILITIES.filter((capability) =>
    requested.has(capability),
  )
  if (normalized.includes('property_trends') && !normalized.includes('review_analysis')) {
    throw new MerchantAiAuthorizationError(
      'invalid_capability_dependency',
      'Property trends requires review analysis',
    )
  }
  return normalized
}

function requireCapabilities(
  capabilities: ReadonlyArray<MerchantAiCapability>,
): ReadonlyArray<MerchantAiCapability> {
  const normalized = normalizeCapabilities(capabilities)
  if (normalized.length === 0) {
    throw new MerchantAiAuthorizationError(
      'capabilities_required',
      'Enabled Merchant AI requires at least one current capability',
    )
  }
  return normalized
}

function validateIdempotencyAndReason(
  input: Readonly<{ idempotencyKey: string; reasonCode: string }>,
): void {
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new MerchantAiAuthorizationError('invalid_command', 'Invalid idempotency key')
  }
  if (!REASON_CODE_PATTERN.test(input.reasonCode)) {
    throw new MerchantAiAuthorizationError('invalid_command', 'Invalid reason code')
  }
}

/** Returns the ceremony's Property ids, lowercase and in the caller's order. */
function validateCeremonyCommand(
  input: MerchantAiEnableForPropertiesInput,
): ReadonlyArray<string> {
  if (input.organizationId.length === 0 || input.actorUserId.length === 0) {
    throw new MerchantAiAuthorizationError(
      'invalid_command',
      'Organization and actor are required',
    )
  }
  validateIdempotencyAndReason(input)
  if (
    input.propertyIds.length === 0 ||
    input.propertyIds.length > MAX_MERCHANT_AI_CEREMONY_PROPERTIES
  ) {
    throw new MerchantAiAuthorizationError(
      'invalid_command',
      `A consent ceremony covers 1 to ${MAX_MERCHANT_AI_CEREMONY_PROPERTIES} properties`,
    )
  }
  const propertyIds = input.propertyIds.map((propertyId) => {
    if (!UUID_PATTERN.test(propertyId)) {
      throw new MerchantAiAuthorizationError('invalid_command', 'Invalid property id')
    }
    return propertyId.toLowerCase()
  })
  if (new Set(propertyIds).size !== propertyIds.length) {
    throw new MerchantAiAuthorizationError(
      'invalid_command',
      'A consent ceremony names each property once',
    )
  }
  return propertyIds
}

function validateCommand(input: MerchantAiCommandInput): void {
  if (
    input.organizationId.length === 0 ||
    input.propertyId.length === 0 ||
    input.actorUserId.length === 0
  ) {
    throw new MerchantAiAuthorizationError(
      'invalid_command',
      'Organization, property, and actor are required',
    )
  }
  if (
    !Number.isSafeInteger(input.expectedStateVersion) ||
    input.expectedStateVersion < 0
  ) {
    throw new MerchantAiAuthorizationError(
      'invalid_command',
      'Invalid expected state version',
    )
  }
  validateIdempotencyAndReason(input)
}

function requireCurrentNotice(
  deps: MerchantAiAuthorizationDeps,
  acknowledgement: MerchantAiNoticeAcknowledgement,
): void {
  if (
    acknowledgement.noticeVersion !== deps.noticeVersion ||
    acknowledgement.noticeDigest !== deps.noticeDigest
  ) {
    throw new MerchantAiAuthorizationError(
      'notice_mismatch',
      'The AI data-use notice changed. Reload it, review it, and confirm again.',
    )
  }
}

type PropertyActor = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
}>

export function createMerchantAiAuthorization(deps: MerchantAiAuthorizationDeps) {
  async function requireManagement(target: PropertyActor, now: Date): Promise<void> {
    if (
      !(await deps.authorizeManagement({
        organizationId: target.organizationId,
        propertyId: target.propertyId,
        actorUserId: target.actorUserId,
        now,
      }))
    ) {
      throw new MerchantAiAuthorizationError(
        'capability_denied',
        'Merchant AI management is denied',
        target.propertyId,
      )
    }
  }

  async function authorizeCapabilities(
    input: PropertyActor,
    capabilities: ReadonlyArray<MerchantAiCapability>,
    now: Date,
  ): Promise<void> {
    for (const capability of capabilities) {
      const runtime = RUNTIME_BY_CAPABILITY.get(capability)
      if (!runtime) {
        throw new MerchantAiAuthorizationError(
          'unsupported_capability',
          `Merchant AI capability '${capability}' is not available`,
        )
      }
      const allowed = await deps.authorize({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        actorUserId: input.actorUserId,
        capability: runtime.purpose,
        now,
      })
      if (!allowed) {
        throw new MerchantAiAuthorizationError(
          'capability_denied',
          `Merchant AI capability '${capability}' is denied`,
          input.propertyId,
        )
      }
    }
  }

  async function mutate(
    input: MerchantAiCommandInput,
    operation: MerchantAiMutationInput['operation'],
    state: MerchantAiMutationInput['state'],
    capabilities: ReadonlyArray<MerchantAiCapability>,
    acknowledgement: MerchantAiNoticeAcknowledgement | null,
  ): Promise<MerchantAiSnapshot> {
    validateCommand(input)
    if (capabilities.length > 0) resolveAiRuntimeCapabilitySet(capabilities)
    if (acknowledgement !== null) requireCurrentNotice(deps, acknowledgement)
    const now = deps.clock()
    await requireManagement(input, now)
    await authorizeCapabilities(input, capabilities, now)
    const snapshot = await deps.store.mutate({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      expectedStateVersion: input.expectedStateVersion,
      operation,
      state,
      capabilities,
      reasonCode: input.reasonCode,
      noticeVersion: deps.noticeVersion,
      noticeDigest: deps.noticeDigest,
      sourcePolicyId: deps.sourcePolicyId,
      routingPolicyVersion: deps.routingPolicyVersion,
      providerDeploymentProfileVersion: deps.providerDeploymentProfileVersion,
      redactionProfileFamily: deps.redactionProfileFamily,
      now,
      ceremonyId: deps.idGen(),
    })
    // Enable deletes a standing deferral inside the mutation transaction, and
    // change and revoke start from an enabled head, which never carries one.
    return Object.freeze({ ...snapshot, decisionDeferredAt: null })
  }

  return {
    async get(input: MerchantAiReadInput): Promise<MerchantAiSnapshot> {
      const now = deps.clock()
      const allowed = await deps.authorizeManagement({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        actorUserId: input.actorUserId,
        now,
      })
      if (!allowed) {
        throw new MerchantAiAuthorizationError(
          'capability_denied',
          'Merchant AI read is denied',
        )
      }
      const scope = { organizationId: input.organizationId, propertyId: input.propertyId }
      const snapshot =
        (await deps.store.getSnapshot(scope)) ?? defaultSnapshot(deps, scope)
      // Read after the head: an enable committing in between deletes the
      // deferral, so the pair may be stale together but never shows an enabled
      // head beside a standing deferral. An enabled head carries none.
      const deferral =
        snapshot.state === 'enabled'
          ? null
          : await deps.decisionDeferrals.findDecisionDeferral(scope)
      return Object.freeze({
        ...snapshot,
        decisionDeferredAt: deferral?.deferredAt.toISOString() ?? null,
      })
    },

    enable(input: MerchantAiConsentCommandInput): Promise<MerchantAiSnapshot> {
      return mutate(
        input,
        'enable',
        'enabled',
        CURRENT_MERCHANT_AI_CAPABILITIES,
        input.acknowledgement,
      )
    },

    async change(
      input: MerchantAiConsentCommandInput & {
        capabilities: ReadonlyArray<MerchantAiCapability>
      },
    ): Promise<MerchantAiSnapshot> {
      const capabilities = requireCapabilities(input.capabilities)
      return mutate(input, 'change', 'enabled', capabilities, input.acknowledgement)
    },

    /**
     * One consent ceremony over several Properties (decision 3): the same
     * authorization, Google-binding and state checks as a single enable, run
     * for every Property, then one atomic store transaction that shares a
     * ceremony id. AccountAdmin only. A replay by idempotency key returns the
     * committed result without writing.
     */
    async enableForProperties(
      input: MerchantAiEnableForPropertiesInput,
    ): Promise<ReadonlyArray<MerchantAiPropertyConsentResult>> {
      const propertyIds = validateCeremonyCommand(input)
      const capabilities = requireCapabilities(input.capabilities)
      resolveAiRuntimeCapabilitySet(capabilities)
      requireCurrentNotice(deps, input.acknowledgement)
      const now = deps.clock()
      if (
        !(await deps.isCurrentAccountAdmin({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
        }))
      ) {
        throw new MerchantAiAuthorizationError(
          'capability_denied',
          'Consent for several properties at once requires an account admin',
        )
      }
      for (const propertyId of propertyIds) {
        const target = {
          organizationId: input.organizationId,
          propertyId,
          actorUserId: input.actorUserId,
        }
        await requireManagement(target, now)
        await authorizeCapabilities(target, capabilities, now)
      }
      return deps.store.enableForProperties({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        propertyIds,
        capabilities,
        idempotencyKey: input.idempotencyKey,
        reasonCode: input.reasonCode,
        noticeVersion: deps.noticeVersion,
        noticeDigest: deps.noticeDigest,
        sourcePolicyId: deps.sourcePolicyId,
        routingPolicyVersion: deps.routingPolicyVersion,
        providerDeploymentProfileVersion: deps.providerDeploymentProfileVersion,
        redactionProfileFamily: deps.redactionProfileFamily,
        now,
        ceremonyId: deps.idGen(),
      })
    },

    /** Withdrawing consent needs no acknowledgement. */
    revoke(input: MerchantAiCommandInput): Promise<MerchantAiSnapshot> {
      return mutate(input, 'revoke', 'revoked', Object.freeze([]), null)
    },
  } as const
}
