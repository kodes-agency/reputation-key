import { sha256Hex } from '#/shared/domain/sha256'
import type { CapabilityRuntimeProfileVersions } from '#/shared/domain/merchant-ai-capability'
import type {
  MerchantAiCapabilityEpochs,
  MerchantAiSnapshot,
} from './merchant-ai-authorization'

/** The reason code on the evidence of a renewal nobody asked for. */
export const STANDING_RENEWAL_REASON = 'standing_renewal'

export type StandingRenewalOwner = Readonly<{
  userId: string
  joinedAt: Date
}>

/** Prefer the standing opt-in's author, then membership tenure, then user id. */
export function standingRenewalActor(
  latestActor: string | null,
  owners: readonly StandingRenewalOwner[],
): string | null {
  if (owners.some((owner) => owner.userId === latestActor)) return latestActor
  return (
    [...owners].sort(
      (a, b) =>
        a.joinedAt.getTime() - b.joinedAt.getTime() || a.userId.localeCompare(b.userId),
    )[0]?.userId ?? null
  )
}

export function standingRenewalKey(
  propertyId: string,
  notice: Readonly<{ noticeVersion: string; noticeDigest: string }>,
): string {
  return `standing-renewal:${sha256Hex(JSON.stringify([propertyId, notice.noticeVersion, notice.noticeDigest]))}`
}

export type StandingRenewalSkip =
  | 'no_account_admin'
  | 'org_suspended'
  | 'policy_denied'
  | 'google_unbound'
  | 'property_not_manageable'
  | 'source_changed'
  | 'head_changed'
  | 'lock_timeout'
  | 'already_renewed'
  | 'newer_notice'

/** Notice ids carry ISO release dates. An outgoing worker must not downgrade
 * a head already advanced by its successor during a rolling deployment. */
export function standingRenewalTargetSkip(
  previousVersion: string,
  targetVersion: string,
): StandingRenewalSkip | null {
  return previousVersion > targetVersion ? 'newer_notice' : null
}

export function standingRenewalPropertySkip(
  input: Readonly<{
    deleted: boolean
    lifecycleState: string
    googleBindingState: string
    sourceEpoch: number
    authorizedSourceEpoch: number
  }>,
): StandingRenewalSkip | null {
  if (input.deleted || input.lifecycleState !== 'active') return 'property_not_manageable'
  if (input.googleBindingState !== 'active') return 'google_unbound'
  if (input.sourceEpoch !== input.authorizedSourceEpoch) return 'source_changed'
  return null
}

/**
 * Whether a renewal leaves the AI drafts a manager already saved. A saved draft
 * binds to the drafting epoch, the recorded drafting runtime and the provider
 * deployment, not to the state version, so a standing renewal that moves none of
 * them changes nothing the draft was written from. Any other change withdraws the
 * drafts, as does the first grant. Suggestions not yet adopted hold no stored text
 * and still fail the exact-notice adoption check of the notice they were drawn under.
 */
export function standingRenewalKeepsSavedDrafts(
  reasonCode: string,
  previous: Pick<
    MerchantAiSnapshot,
    | 'capabilityEpochs'
    | 'capabilityRuntimeProfileVersions'
    | 'providerDeploymentProfileVersion'
  > | null,
  next: Readonly<{
    capabilityEpochs: MerchantAiCapabilityEpochs
    runtimeProfiles: CapabilityRuntimeProfileVersions
    providerDeploymentProfileVersion: string
  }>,
): boolean {
  return (
    reasonCode === STANDING_RENEWAL_REASON &&
    previous !== null &&
    next.capabilityEpochs.reply_drafting === previous.capabilityEpochs.reply_drafting &&
    next.runtimeProfiles.reply_drafting ===
      previous.capabilityRuntimeProfileVersions.reply_drafting &&
    next.providerDeploymentProfileVersion === previous.providerDeploymentProfileVersion
  )
}
