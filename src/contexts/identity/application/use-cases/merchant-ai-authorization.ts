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

export type MerchantAiAuthorizationStore = Readonly<{
  getSnapshot(input: {
    organizationId: string
    propertyId: string
  }): Promise<MerchantAiSnapshot | null>
  /** An enable also deletes the Property's standing decision deferral, atomically. */
  mutate(input: MerchantAiMutationInput): Promise<MerchantAiSnapshot>
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

export type MerchantAiAuthorization = ReturnType<typeof createMerchantAiAuthorization>

const RUNTIME_BY_CAPABILITY = new Map(
  AI_RUNTIME_CAPABILITIES_V1.map((entry) => [entry.capability, entry] as const),
)
const CURRENT_CAPABILITY_SET: ReadonlySet<string> = new Set(
  CURRENT_MERCHANT_AI_CAPABILITIES,
)
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/

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
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new MerchantAiAuthorizationError('invalid_command', 'Invalid idempotency key')
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
  if (!REASON_CODE_PATTERN.test(input.reasonCode)) {
    throw new MerchantAiAuthorizationError('invalid_command', 'Invalid reason code')
  }
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

export function createMerchantAiAuthorization(deps: MerchantAiAuthorizationDeps) {
  async function authorizeCapabilities(
    input: MerchantAiCommandInput,
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
    if (
      !(await deps.authorizeManagement({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        actorUserId: input.actorUserId,
        now,
      }))
    ) {
      throw new MerchantAiAuthorizationError(
        'capability_denied',
        'Merchant AI management is denied',
      )
    }
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
      const capabilities = normalizeCapabilities(input.capabilities)
      if (capabilities.length === 0) {
        throw new MerchantAiAuthorizationError(
          'capabilities_required',
          'Enabled Merchant AI requires at least one current capability',
        )
      }
      return mutate(input, 'change', 'enabled', capabilities, input.acknowledgement)
    },

    /** Withdrawing consent needs no acknowledgement. */
    revoke(input: MerchantAiCommandInput): Promise<MerchantAiSnapshot> {
      return mutate(input, 'revoke', 'revoked', Object.freeze([]), null)
    },
  } as const
}
