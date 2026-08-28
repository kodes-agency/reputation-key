import { z } from 'zod/v4'
import {
  AI_INTERNAL_RESPONSE_MAX_BYTES,
  AI_SETTLE_MAX_BYTES,
  aiSettlementReceiptSchema,
  parseAiExecutionGrant,
  parseAiInternalJsonBytes,
  type AiExecutionGrantV1,
  type AiSettlementReceiptV1,
} from '../../src/shared/ai-internal-transport-contract'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'
import type {
  InternalMtlsRawResponse,
  InternalMtlsRequestOptions,
} from '../internal-mtls'
import type { AiAdmissionClient } from './contracts'

const authorizationDenialSchema = z.enum([
  'malformed_request',
  'request_binding_invalid',
  'subject_mismatch',
  'source_mismatch',
  'authorization_changed',
  'control_disabled',
  'circuit_open',
  'rate_limited',
  'concurrency_exhausted',
  'quota_exhausted',
  'permit_unknown',
  'permit_expired',
  'already_consumed',
  'canary_not_eligible',
])
const settlementDenialSchema = z.enum([
  'permit_unknown',
  'permit_mismatch',
  'permit_not_consumed',
  'settlement_conflict',
])

const authorizationResponseSchema = z.union([
  z.object({ ok: z.literal(true), grant: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), code: authorizationDenialSchema }).strict(),
])
const settlementResponseSchema = z.union([
  z.object({ ok: z.literal(true), receipt: aiSettlementReceiptSchema }).strict(),
  z.object({ ok: z.literal(false), code: settlementDenialSchema }).strict(),
])

export type AiAdmissionByteTransport = Readonly<{
  postBytesRaw(
    path: '/v1/authorize' | '/v1/settle',
    body: Uint8Array,
    options: InternalMtlsRequestOptions,
  ): Promise<InternalMtlsRawResponse>
  get(path: '/health/ready', options: InternalMtlsRequestOptions): Promise<unknown>
}>

export type AiAdmissionAuthorizationResult =
  | Readonly<{ status: 'authorized'; grant: AiExecutionGrantV1 }>
  | Readonly<{ status: 'denied'; code: z.infer<typeof authorizationDenialSchema> }>
export type AiAdmissionSettlementResult =
  | Readonly<{ status: 'settled'; receipt: AiSettlementReceiptV1 }>
  | Readonly<{ status: 'denied'; code: z.infer<typeof settlementDenialSchema> }>

function requestBytes(value: unknown): Uint8Array {
  const bytes = Buffer.from(canonicalizeRfc8785(value), 'utf8')
  if (bytes.byteLength < 1 || bytes.byteLength > AI_INTERNAL_RESPONSE_MAX_BYTES) {
    bytes.fill(0)
    throw new TypeError('AI admission request is invalid')
  }
  return bytes
}

function requireStrictJsonResponse<T>(
  response: InternalMtlsRawResponse,
  schema: z.ZodType<T>,
): T {
  try {
    if (
      response.status !== 200 ||
      !/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*utf-8)?$/i.test(
        response.headers.get('content-type') ?? '',
      ) ||
      response.headers.has('content-encoding')
    ) {
      throw new TypeError('AI admission response is invalid')
    }
    return parseAiInternalJsonBytes(response.body, AI_INTERNAL_RESPONSE_MAX_BYTES, schema)
  } finally {
    response.body.fill(0)
  }
}

export function createAiAdmissionClient(
  transport: AiAdmissionByteTransport,
): AiAdmissionClient {
  return Object.freeze({
    authorize: async (request, signal) => {
      const bytes = requestBytes(request)
      try {
        const response = requireStrictJsonResponse(
          await transport.postBytesRaw('/v1/authorize', bytes, {
            signal,
            deadlineEpochMillis: request.descriptor.callerDeadlineEpochMillis,
          }),
          authorizationResponseSchema,
        )
        if (!response.ok) return { status: 'denied', code: response.code }
        return { status: 'authorized', grant: parseAiExecutionGrant(response.grant) }
      } finally {
        bytes.fill(0)
      }
    },
    settle: async (request, signal) => {
      const bytes = requestBytes(request)
      if (bytes.byteLength > AI_SETTLE_MAX_BYTES) {
        bytes.fill(0)
        throw new TypeError('AI settlement request is invalid')
      }
      try {
        const response = requireStrictJsonResponse(
          await transport.postBytesRaw('/v1/settle', bytes, { signal }),
          settlementResponseSchema,
        )
        return response.ok
          ? { status: 'settled', receipt: response.receipt }
          : { status: 'denied', code: response.code }
      } finally {
        bytes.fill(0)
      }
    },
    readiness: async (signal) => {
      if (signal.aborted) return false
      try {
        const value = await transport.get('/health/ready', { signal })
        return z
          .object({ ok: z.literal(true) })
          .strict()
          .safeParse(value).success
      } catch {
        return false
      }
    },
  })
}
