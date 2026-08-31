import { z } from 'zod/v4'
import {
  GOOGLE_ENDPOINT_CLASSES,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
} from '../../src/shared/google-provider-control/contracts'
import { parseGoogleAdmissionGrant } from '../../src/shared/google-provider-control/admission-grant-store'
import type {
  GoogleAdmissionStartResult,
  GoogleExecutionAdmissionService,
} from './service'

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const requestClasses = [
  'identity',
  'discovery',
  'performance',
  'credential_refresh',
  'credential_cleanup',
  'reviews',
  'notifications',
] as const
const metadataSchema = z
  .object({
    routeKey: z.enum(GOOGLE_PROVIDER_ROUTE_KEYS),
    catalogueVersion: z.literal(GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION),
    endpointClass: z.enum(GOOGLE_ENDPOINT_CLASSES),
    requestClass: z.enum(requestClasses),
    requestBindingSha256: z.string().regex(SHA256),
    credentialBinding: z.union([z.literal('none'), z.string().regex(SHA256)]),
    requestBodySha256: z.union([z.null(), z.string().regex(SHA256)]),
    requestBodyBytes: z.number().int().safe().nonnegative(),
    maxRequestBytes: z.number().int().safe().nonnegative(),
    maxResponseBytes: z.number().int().safe().positive(),
    quotaPolicyId: z.string().min(1).max(128),
    inFlightPolicyId: z.string().min(1).max(128),
  })
  .strict()
const startBodySchema = z
  .object({
    permitId: z.string().regex(SAFE_ID),
    admission: metadataSchema,
    deadlineMs: z.number().int().safe().positive(),
  })
  .strict()
const redeemBodySchema = z
  .object({
    grant: z.unknown(),
    admission: metadataSchema,
  })
  .strict()
const completeBodySchema = z
  .object({
    admissionId: z.string().regex(SAFE_ID),
    outcome: z.enum([
      'success',
      'provider_4xx',
      'provider_5xx',
      'rate_limited',
      'deadline_exceeded',
      'transport_error',
      'response_too_large',
      'caller_abandoned',
    ]),
    retryAfterMs: z.union([z.null(), z.number().int().safe().min(0).max(300_000)]),
  })
  .strict()

export type GoogleAdmissionJsonTransport = Readonly<{
  post(path: '/v1/start' | '/v1/redeem' | '/v1/complete', body: unknown): Promise<unknown>
}>

async function readBoundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > 32 * 1024) {
      throw new Error('admission request body is invalid')
    }
  }
  if (!request.body) throw new Error('admission request body is missing')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      totalBytes += next.value.byteLength
      if (totalBytes > 32 * 1024) {
        await reader.cancel()
        throw new Error('admission request body is invalid')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('admission request body is invalid')
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get('content-type')
  return (
    contentType !== null &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) &&
    request.headers.get('content-encoding') === null
  )
}

export async function handleGoogleExecutionAdmissionRequest(
  input: Readonly<{
    request: Request
    gatewayIdentity: string | null
    service: GoogleExecutionAdmissionService
    readiness?: () => Promise<boolean>
  }>,
): Promise<Response> {
  const url = new URL(input.request.url)
  const exactPath = url.search === '' && url.hash === ''
  if (input.request.method === 'GET' && exactPath && url.pathname === '/health/ready') {
    const ready = input.readiness ? await input.readiness() : true
    return jsonResponse({ ok: ready }, ready ? 200 : 503)
  }
  if (input.request.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'method_not_allowed' }, 405)
  }
  const gatewayIdentity = input.gatewayIdentity
  if (!gatewayIdentity || !SAFE_ID.test(gatewayIdentity)) {
    return jsonResponse({ ok: false, code: 'unauthorized' }, 401)
  }
  if (!exactPath || !['/v1/start', '/v1/redeem', '/v1/complete'].includes(url.pathname)) {
    return jsonResponse({ ok: false, code: 'not_found' }, 404)
  }
  if (!hasJsonContentType(input.request)) {
    return jsonResponse({ ok: false, code: 'malformed_request' }, 400)
  }
  let body: unknown
  try {
    body = await readBoundedJson(input.request)
  } catch {
    return jsonResponse({ ok: false, code: 'malformed_request' }, 400)
  }
  if (url.pathname === '/v1/start') {
    const parsed = startBodySchema.safeParse(body)
    if (!parsed.success) {
      return jsonResponse({ ok: false, code: 'malformed_request' }, 400)
    }
    return jsonResponse(
      await input.service.start({
        ...parsed.data,
        gatewayIdentity,
      }),
    )
  }
  if (url.pathname === '/v1/redeem') {
    const parsed = redeemBodySchema.safeParse(body)
    if (!parsed.success) {
      return jsonResponse({ ok: false, code: 'malformed_request' }, 400)
    }
    try {
      return jsonResponse(
        await input.service.redeem({
          grant: parseGoogleAdmissionGrant(parsed.data.grant),
          gatewayIdentity,
          admission: parsed.data.admission,
        }),
      )
    } catch {
      return jsonResponse({ ok: false, code: 'grant_mismatch' }, 400)
    }
  }
  if (url.pathname === '/v1/complete') {
    const parsed = completeBodySchema.safeParse(body)
    if (!parsed.success) {
      return jsonResponse({ ok: false, code: 'malformed_request' }, 400)
    }
    return jsonResponse({ ok: await input.service.complete(parsed.data) })
  }
  return jsonResponse({ ok: false, code: 'not_found' }, 404)
}

function parseStartResult(value: unknown): GoogleAdmissionStartResult {
  if (!value || typeof value !== 'object') {
    throw new Error('execution admission response is invalid')
  }
  const raw = value as Record<string, unknown>
  if (raw.ok === true) {
    return { ok: true, grant: parseGoogleAdmissionGrant(raw.grant) }
  }
  const parsed = z
    .object({
      ok: z.literal(false),
      code: z.enum([
        'malformed_request',
        'permit_unknown',
        'permit_expired',
        'gateway_mismatch',
        'route_mismatch',
        'request_mismatch',
        'quota_exhausted',
        'in_flight_exhausted',
        'coordination_unavailable',
        'authorization_changed',
        'grant_unavailable',
      ]),
      retryAfterMs: z.number().int().safe().nonnegative(),
    })
    .strict()
    .safeParse(value)
  if (!parsed.success) throw new Error('execution admission response is invalid')
  return parsed.data
}

export function createGoogleExecutionAdmissionHttpClient(
  transport: GoogleAdmissionJsonTransport,
): Pick<GoogleExecutionAdmissionService, 'start' | 'redeem' | 'complete'> {
  return Object.freeze({
    start: async (input) =>
      parseStartResult(
        await transport.post('/v1/start', {
          permitId: input.permitId,
          admission: input.admission,
          deadlineMs: input.deadlineMs,
        }),
      ),
    redeem: async (input) => {
      const raw = await transport.post('/v1/redeem', {
        grant: input.grant,
        admission: input.admission,
      })
      const parsed = z
        .union([
          z.object({ ok: z.literal(true) }).strict(),
          z
            .object({
              ok: z.literal(false),
              code: z.enum([
                'grant_unknown',
                'grant_expired',
                'grant_replayed',
                'grant_mismatch',
              ]),
            })
            .strict(),
        ])
        .safeParse(raw)
      if (!parsed.success) throw new Error('execution admission response is invalid')
      return parsed.data
    },
    complete: async (input) => {
      const raw = await transport.post('/v1/complete', input)
      const parsed = z.object({ ok: z.boolean() }).strict().safeParse(raw)
      if (!parsed.success) throw new Error('execution admission response is invalid')
      return parsed.data.ok
    },
  })
}
