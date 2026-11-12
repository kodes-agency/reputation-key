import { createHash } from 'node:crypto'
import type {
  AiAdmissionDescriptorV1,
  AiAdmissionLimitsV1,
  AiSettlementOutcome,
  AiSettlementPermit,
  AiSettlementReceiptV1,
} from '#/shared/ai-internal-transport-contract'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'

const DESCRIPTOR_DOMAIN = 'ai-admission-descriptor-v1\0'
const admissionBrand: unique symbol = Symbol('AiExecutionAdmission')

/**
 * The database authority's yes to one provider call: the attempt it admitted,
 * the limits and deadline it admitted it under, and a digest of the exact
 * descriptor it read. Only the AI admission adapter mints one, and the dispatch
 * gate consumes it, so an object that did not come from the authority, or one
 * that already dispatched, never reaches a provider.
 */
export type AiExecutionAdmission = Readonly<{
  subjectKind: AiAdmissionDescriptorV1['subjectKind']
  route: AiAdmissionDescriptorV1['route']
  operationId: string
  permitId: string
  attemptNumber: number
  limits: AiAdmissionLimitsV1
  callerDeadlineEpochMillis: number
  descriptorDigest: string
  issuedAtEpochMillis: number
  expiresAtEpochMillis: number
  replyTokenExpiresAtEpochMillis: number | null
  replyDraftExpiresAtEpochMillis: number | null
  [admissionBrand]: true
}>

export type AiAdmissionDenialCode =
  | 'malformed_request'
  | 'subject_mismatch'
  | 'source_mismatch'
  | 'authorization_changed'
  | 'control_disabled'
  | 'quota_exhausted'
  | 'permit_expired'
  | 'already_consumed'
  | 'canary_not_eligible'

export type AiSettlementDenialCode =
  'permit_unknown' | 'permit_mismatch' | 'permit_not_consumed' | 'settlement_conflict'

/** The final pre-send authority and the settlement ledger, both in PostgreSQL. */
export type AiExecutionAdmissionAuthority = Readonly<{
  authorize(
    descriptor: AiAdmissionDescriptorV1,
  ): Promise<
    | Readonly<{ status: 'admitted'; admission: AiExecutionAdmission }>
    | Readonly<{ status: 'denied'; code: AiAdmissionDenialCode }>
  >
  settle(
    permit: AiSettlementPermit,
    outcome: AiSettlementOutcome,
  ): Promise<
    | Readonly<{ status: 'settled'; receipt: AiSettlementReceiptV1 }>
    | Readonly<{ status: 'denied'; code: AiSettlementDenialCode }>
  >
  readiness(): Promise<boolean>
}>

const minted = new WeakSet<object>()
const consumed = new WeakSet<object>()

export function aiAdmissionDescriptorDigest(descriptor: AiAdmissionDescriptorV1): string {
  return createHash('sha256')
    .update(DESCRIPTOR_DOMAIN, 'utf8')
    .update(canonicalizeRfc8785(descriptor), 'utf8')
    .digest('hex')
}

/**
 * Mints the admission for a descriptor the authority has just admitted. Only
 * the AI admission adapter calls this; a source-boundary test pins that.
 */
export function mintAiExecutionAdmission(
  descriptor: AiAdmissionDescriptorV1,
  issued: Readonly<{
    issuedAtEpochMillis: number
    replyTokenExpiresAtEpochMillis: number | null
    replyDraftExpiresAtEpochMillis: number | null
  }>,
): AiExecutionAdmission {
  const admission: AiExecutionAdmission = Object.freeze({
    subjectKind: descriptor.subjectKind,
    route: descriptor.route,
    operationId: descriptor.operationId,
    permitId: descriptor.permitId,
    attemptNumber: descriptor.attemptNumber,
    limits: Object.freeze({ ...descriptor.limits }),
    callerDeadlineEpochMillis: descriptor.callerDeadlineEpochMillis,
    descriptorDigest: aiAdmissionDescriptorDigest(descriptor),
    issuedAtEpochMillis: issued.issuedAtEpochMillis,
    expiresAtEpochMillis: descriptor.callerDeadlineEpochMillis,
    replyTokenExpiresAtEpochMillis: issued.replyTokenExpiresAtEpochMillis,
    replyDraftExpiresAtEpochMillis: issued.replyDraftExpiresAtEpochMillis,
    [admissionBrand]: true as const,
  })
  minted.add(admission)
  return admission
}

/** Whether the authority in this process minted this exact object. */
export function isMintedAiExecutionAdmission(
  value: unknown,
): value is AiExecutionAdmission {
  return typeof value === 'object' && value !== null && minted.has(value)
}

/**
 * Spends the admission. True exactly once for an object the authority minted;
 * a copy, a forgery or a second call is false.
 */
export function consumeAiExecutionAdmission(value: unknown): boolean {
  if (!isMintedAiExecutionAdmission(value) || consumed.has(value)) return false
  consumed.add(value)
  return true
}

export function settlementPermitOf(admission: AiExecutionAdmission): AiSettlementPermit {
  return Object.freeze({
    operationId: admission.operationId,
    permitId: admission.permitId,
    attemptNumber: admission.attemptNumber,
  })
}
