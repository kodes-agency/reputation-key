import type { KeyObject } from 'node:crypto'
import {
  parseAiAdmissionRequest,
  signAiExecutionGrant,
  verifyAiRequestBinding,
  type AiAdmissionDescriptorV1,
  type AiAdmissionRequestV1,
  type AiExecutionGrantV1,
  type AiSettlementReceiptV1,
  type AiSettlementPermit,
  type AiSettlementOutcome,
} from '#/shared/ai-internal-transport-contract'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

export type AiAdmissionDenialCode =
  | 'malformed_request'
  | 'request_binding_invalid'
  | 'subject_mismatch'
  | 'source_mismatch'
  | 'authorization_changed'
  | 'control_disabled'
  | 'circuit_open'
  | 'concurrency_exhausted'
  | 'quota_exhausted'
  | 'permit_unknown'
  | 'permit_expired'
  | 'already_consumed'
  | 'canary_not_eligible'

export type AiSettlementDenialCode =
  'permit_unknown' | 'permit_mismatch' | 'permit_not_consumed' | 'settlement_conflict'

type DatabaseAdmission = Readonly<{
  status: 'admitted'
  nonce: string
  issuedAtEpochMillis: number
  expiresAtEpochMillis: number
  replyTokenExpiresAtEpochMillis: number | null
  replyDraftExpiresAtEpochMillis: number | null
}>
type DatabaseAdmissionResult =
  | DatabaseAdmission
  | Readonly<{
      status: 'denied'
      code: Exclude<
        AiAdmissionDenialCode,
        'malformed_request' | 'request_binding_invalid'
      >
    }>

type DatabaseSettlementResult =
  | (AiSettlementReceiptV1 & Readonly<{ status: 'settled' }>)
  | Readonly<{ status: 'denied'; code: AiSettlementDenialCode }>

export type AiAdmissionDatabaseAuthority = Readonly<{
  authorizeProperty(
    descriptor: Extract<AiAdmissionDescriptorV1, { subjectKind: 'property' }>,
    requestBinding: Readonly<{ keyId: string; hmac: string }>,
  ): Promise<DatabaseAdmissionResult>
  authorizeCanary(
    descriptor: Extract<AiAdmissionDescriptorV1, { subjectKind: 'synthetic_canary' }>,
    requestBinding: Readonly<{ keyId: string; hmac: string }>,
  ): Promise<DatabaseAdmissionResult>
  settle(
    permit: AiSettlementPermit,
    outcome: AiSettlementOutcome,
  ): Promise<DatabaseSettlementResult>
  readiness(): Promise<boolean>
}>

export type AiExecutionAdmissionService = Readonly<{
  authorize(
    request: AiAdmissionRequestV1,
  ): Promise<
    | Readonly<{ ok: true; grant: AiExecutionGrantV1 }>
    | Readonly<{ ok: false; code: AiAdmissionDenialCode }>
  >
  settle(
    permit: AiSettlementPermit,
    outcome: AiSettlementOutcome,
  ): Promise<
    | Readonly<{ ok: true; receipt: AiSettlementReceiptV1 }>
    | Readonly<{ ok: false; code: AiSettlementDenialCode }>
  >
  readiness(): Promise<boolean>
}>

function unavailable(): Error {
  return new Error('AI admission authority is unavailable')
}

function isValidSigningKid(value: string): boolean {
  return /^[a-z][a-z0-9_-]{0,31}$/.test(value)
}

export function createAiExecutionAdmissionService(
  dependencies: Readonly<{
    requestBindingKeys: VersionedHmacKeyring
    signingKid: string
    signingPrivateKey: KeyObject
    database: AiAdmissionDatabaseAuthority
  }>,
): AiExecutionAdmissionService {
  if (!isValidSigningKid(dependencies.signingKid)) {
    throw new Error('AI admission signing key ID is invalid')
  }

  return Object.freeze({
    authorize: async (request) => {
      const parsed = parseAiAdmissionRequest(request)
      if (!verifyAiRequestBinding(parsed, dependencies.requestBindingKeys)) {
        return { ok: false, code: 'request_binding_invalid' }
      }
      let result: DatabaseAdmissionResult
      try {
        const requestBinding = Object.freeze({
          keyId: parsed.requestBindingKeyId,
          hmac: parsed.requestBindingHmac,
        })
        result =
          parsed.descriptor.subjectKind === 'property'
            ? await dependencies.database.authorizeProperty(
                parsed.descriptor,
                requestBinding,
              )
            : await dependencies.database.authorizeCanary(
                parsed.descriptor,
                requestBinding,
              )
      } catch {
        throw unavailable()
      }
      if (result.status === 'denied') return { ok: false, code: result.code }
      try {
        return {
          ok: true,
          grant: signAiExecutionGrant(
            {
              version: 'ai-execution-grant-v1',
              subjectKind: parsed.descriptor.subjectKind,
              grantKid: dependencies.signingKid,
              requestBindingKeyId: parsed.requestBindingKeyId,
              requestBindingHmac: parsed.requestBindingHmac,
              route: parsed.descriptor.route,
              operationId: parsed.descriptor.operationId,
              permitId: parsed.descriptor.permitId,
              attemptNumber: parsed.descriptor.attemptNumber,
              nonce: result.nonce,
              limits: parsed.descriptor.limits,
              callerDeadlineEpochMillis: parsed.descriptor.callerDeadlineEpochMillis,
              issuedAtEpochMillis: result.issuedAtEpochMillis,
              expiresAtEpochMillis: result.expiresAtEpochMillis,
              replyTokenExpiresAtEpochMillis: result.replyTokenExpiresAtEpochMillis,
              replyDraftExpiresAtEpochMillis: result.replyDraftExpiresAtEpochMillis,
            },
            dependencies.signingPrivateKey,
          ),
        }
      } catch {
        try {
          const released = await dependencies.database.settle(
            {
              operationId: parsed.descriptor.operationId,
              permitId: parsed.descriptor.permitId,
              attemptNumber: parsed.descriptor.attemptNumber,
              nonce: result.nonce,
              grantKid: dependencies.signingKid,
            },
            {
              disposition: 'no_dispatch',
              reportedDisposition: 'no_dispatch',
              providerRetryable: false,
              usageKnown: false,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              retryAfterSeconds: null,
            },
          )
          if (
            released.status !== 'settled' ||
            released.grantKid !== dependencies.signingKid ||
            released.disposition !== 'no_dispatch' ||
            released.settlementState !== 'released' ||
            released.costMicros !== 0
          ) {
            throw unavailable()
          }
        } catch {
          throw unavailable()
        }
        throw unavailable()
      }
    },

    settle: async (permit, outcome) => {
      let result: DatabaseSettlementResult
      try {
        result = await dependencies.database.settle(permit, outcome)
      } catch {
        throw unavailable()
      }
      if (result.status === 'denied') return { ok: false, code: result.code }
      const { status: _status, ...receipt } = result
      return { ok: true, receipt }
    },

    readiness: async () => {
      try {
        return await dependencies.database.readiness()
      } catch {
        return false
      }
    },
  })
}
