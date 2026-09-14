import type {
  CapabilityRuntimeProfileVersions,
  MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'

export {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'

export type CurrentMerchantAiCapability = MerchantAiCapability
export type MerchantAiState = 'disabled' | 'enabled' | 'revoked'

export type MerchantAiCapabilityEpochs = Readonly<Record<MerchantAiCapability, number>>

export type MerchantAiSnapshot = Readonly<{
  organizationId: string
  propertyId: string
  state: MerchantAiState
  authorizationLineageId: string | null
  capabilities: ReadonlyArray<MerchantAiCapability>
  capabilityRuntimeProfileVersions: CapabilityRuntimeProfileVersions
  capabilityEpochs: MerchantAiCapabilityEpochs
  authorizedSourceEpoch: number
  analysisStartSequence: number
  stateVersion: number
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  routingPolicyVersion: number
  processingRegion: 'global'
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  redactionProfileFamily: string
  /**
   * ISO-8601 instant of the standing "not now" AI decision for this Property,
   * or null when none stands. Enabling AI clears it, so an enabled snapshot
   * always carries null. Optional only so snapshots built before the deferral
   * existed stay assignable; read an absent value as null.
   */
  decisionDeferredAt?: string | null
}>

/** The notice and processing policy a grant is recorded under. */
export type MerchantAiExecutionContract = Readonly<{
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  routingPolicyVersion: number
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  redactionProfileFamily: string
}>

/** What a consent command asks a Property's grant to be. */
export type MerchantAiDesiredGrant = MerchantAiExecutionContract &
  Readonly<{
    /** Normalized: unique and in catalogue order. */
    capabilities: ReadonlyArray<MerchantAiCapability>
    capabilityRuntimeProfileVersions: CapabilityRuntimeProfileVersions
    authorizedSourceEpoch: number
  }>

export function isMerchantAiExecutionContractCurrent(
  recorded: MerchantAiExecutionContract,
  served: MerchantAiExecutionContract,
): boolean {
  return (
    recorded.noticeVersion === served.noticeVersion &&
    recorded.noticeDigest === served.noticeDigest &&
    recorded.sourcePolicyId === served.sourcePolicyId &&
    recorded.routingPolicyVersion === served.routingPolicyVersion &&
    recorded.providerDeploymentProfileVersion ===
      served.providerDeploymentProfileVersion &&
    recorded.redactionProfileFamily === served.redactionProfileFamily
  )
}

function sameCapabilities(
  left: ReadonlyArray<MerchantAiCapability>,
  right: ReadonlyArray<MerchantAiCapability>,
): boolean {
  return (
    left.length === right.length &&
    left.every((capability, index) => capability === right[index])
  )
}

function sameRuntimeProfiles(
  left: CapabilityRuntimeProfileVersions,
  right: CapabilityRuntimeProfileVersions,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        left[key as MerchantAiCapability] === right[key as MerchantAiCapability],
    )
  )
}

/**
 * True when a grant already records exactly the desired one: the same
 * capabilities, runtime profiles, source epoch, and execution contract.
 * Recording it again would be a transition that changes nothing, so it never
 * bumps an epoch or writes evidence. Callers check the grant's state.
 */
export function isMerchantAiGrantCurrent(
  current: MerchantAiSnapshot,
  desired: MerchantAiDesiredGrant,
): boolean {
  return (
    sameCapabilities(current.capabilities, desired.capabilities) &&
    sameRuntimeProfiles(
      current.capabilityRuntimeProfileVersions,
      desired.capabilityRuntimeProfileVersions,
    ) &&
    current.authorizedSourceEpoch === desired.authorizedSourceEpoch &&
    isMerchantAiExecutionContractCurrent(current, desired)
  )
}

/**
 * How one consent ceremony brings a single Property to the desired grant:
 * enable a disabled or revoked grant, re-grant an enabled one that differs
 * (older notice, other capabilities, rebound source, or policy drift), or
 * leave an identical enabled grant alone.
 */
export type MerchantAiConsentTransition =
  | Readonly<{ kind: 'enable' }>
  | Readonly<{ kind: 'change' }>
  | Readonly<{ kind: 'unchanged'; current: MerchantAiSnapshot }>

export function planMerchantAiConsentTransition(
  current: MerchantAiSnapshot | null,
  desired: MerchantAiDesiredGrant,
): MerchantAiConsentTransition {
  if (current === null || current.state !== 'enabled') return { kind: 'enable' }
  return isMerchantAiGrantCurrent(current, desired)
    ? { kind: 'unchanged', current }
    : { kind: 'change' }
}
