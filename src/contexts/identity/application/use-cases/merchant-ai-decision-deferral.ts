// Merchant AI decision deferral — a durable "not now" for one Property.
//
// Deferring records that an authorized manager chose not to enable AI yet, so
// setup stops asking. It is not consent and changes no authorization: no
// evidence row, notice acknowledgement, capability or epoch is touched. It is
// refused while AI is enabled, and enabling AI deletes it in the same
// transaction as the enable (see MerchantAiAuthorizationStore.mutate).

import { merchantAiDecisionError } from '../../domain/merchant-ai-decision-errors'
import {
  MerchantAiAuthorizationError,
  type MerchantAiAuthorizationDeps,
} from './merchant-ai-authorization'

export type MerchantAiDecisionDeferral = Readonly<{
  organizationId: string
  propertyId: string
  deferredBy: string
  deferredAt: Date
}>

export type MerchantAiDecisionDeferralOutcome =
  | Readonly<{ outcome: 'deferred'; deferral: MerchantAiDecisionDeferral }>
  | Readonly<{ outcome: 'already_enabled' }>
  | Readonly<{ outcome: 'property_not_found' }>
  | Readonly<{ outcome: 'authority_denied' }>

/** The read the authorization snapshot needs; it carries no mutation authority. */
export type MerchantAiDecisionDeferralReader = Readonly<{
  findDecisionDeferral(
    input: Readonly<{ organizationId: string; propertyId: string }>,
  ): Promise<MerchantAiDecisionDeferral | null>
}>

export type MerchantAiDecisionDeferralStore = MerchantAiDecisionDeferralReader &
  Readonly<{
    /**
     * One transaction: lock the live Property, recheck current AI management
     * authority, refuse an enabled authorization, then keep the standing
     * deferral. A repeat while one stands is a no-op that returns the original.
     */
    deferDecision(
      input: Readonly<{
        organizationId: string
        propertyId: string
        actorUserId: string
        now: Date
      }>,
    ): Promise<MerchantAiDecisionDeferralOutcome>
  }>

export type MerchantAiDecisionDeferralDeps = Readonly<{
  store: MerchantAiDecisionDeferralStore
  authorizeManagement: MerchantAiAuthorizationDeps['authorizeManagement']
  clock: () => Date
}>

export type MerchantAiDeferDecisionInput = Readonly<{
  organizationId: string
  propertyId: string
  actorUserId: string
}>

export type MerchantAiDecisionDeferralResult = Readonly<{
  propertyId: string
  /** ISO-8601 instant of the standing deferral; unchanged by a repeat. */
  decisionDeferredAt: string
}>

function validateInput(input: MerchantAiDeferDecisionInput): void {
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
}

export function createMerchantAiDecisionDeferral(deps: MerchantAiDecisionDeferralDeps) {
  return {
    async defer(
      input: MerchantAiDeferDecisionInput,
    ): Promise<MerchantAiDecisionDeferralResult> {
      validateInput(input)
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
          'Merchant AI management is denied',
        )
      }

      const result = await deps.store.deferDecision({ ...input, now })
      switch (result.outcome) {
        case 'deferred':
          return {
            propertyId: result.deferral.propertyId,
            decisionDeferredAt: result.deferral.deferredAt.toISOString(),
          }
        case 'already_enabled':
          throw merchantAiDecisionError(
            'already_enabled',
            'AI is already enabled for this property',
          )
        case 'property_not_found':
          throw merchantAiDecisionError('property_not_found', 'Property was not found')
        case 'authority_denied':
          throw new MerchantAiAuthorizationError(
            'capability_denied',
            'Merchant AI management is denied',
          )
      }
    },
  } as const
}

export type MerchantAiDecisionDeferralService = ReturnType<
  typeof createMerchantAiDecisionDeferral
>
