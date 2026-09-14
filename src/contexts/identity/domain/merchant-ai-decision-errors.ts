// Identity Merchant AI decision — domain errors.
//
// Business refusals of the per-Property AI decision commands. Authorization
// denials keep the Merchant AI authorization error so every AI management
// command fails the same way; these codes cover what only a decision can hit.

import { createErrorFactory } from '#/shared/domain/errors'

export type MerchantAiDecisionErrorCode = 'already_enabled' | 'property_not_found'

export type MerchantAiDecisionError = Readonly<{
  _tag: 'MerchantAiDecisionError'
  code: MerchantAiDecisionErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a MerchantAiDecisionError. */
export const merchantAiDecisionError = createErrorFactory<
  MerchantAiDecisionError['_tag'],
  MerchantAiDecisionError['code']
>('MerchantAiDecisionError')

/** Type guard — lets server functions detect MerchantAiDecisionError at catch time. */
export const isMerchantAiDecisionError = (e: unknown): e is MerchantAiDecisionError =>
  typeof e === 'object' &&
  e !== null &&
  (e as { _tag?: string })._tag === 'MerchantAiDecisionError'
