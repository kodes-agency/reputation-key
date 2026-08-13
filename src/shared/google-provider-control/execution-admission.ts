import type {
  GoogleAdmissionDenyCode,
  GoogleAuthorizationVector,
  GoogleExecutionAdmission,
  GoogleExecutionAdmissionRequest,
  GoogleExecutionPermit,
} from './contracts'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_POLICIES,
} from './route-catalogue'

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const MAX_ADMISSION_BYTES = 8 * 1024 * 1024

function validGeneration(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 1)
}

export function validateGoogleExecutionAdmissionRequest(
  request: GoogleExecutionAdmissionRequest,
  nowMs: number,
): GoogleAdmissionDenyCode | null {
  if (
    !SAFE_ID.test(request.organizationId) ||
    !SAFE_ID.test(request.connectionId) ||
    (request.propertyId !== null && !SAFE_ID.test(request.propertyId)) ||
    !Number.isSafeInteger(request.requestBodyBytes) ||
    !Number.isSafeInteger(request.maxRequestBytes) ||
    !Number.isSafeInteger(request.maxResponseBytes) ||
    request.requestBodyBytes < 0 ||
    request.maxRequestBytes < 0 ||
    request.maxResponseBytes < 1 ||
    ![
      request.authorization.lifecycleVersion,
      request.authorization.accessVersion,
      request.authorization.credentialGeneration,
      request.authorization.propertyAuthorizationGeneration,
      request.authorization.routingPolicyVersion,
    ].every(validGeneration) ||
    request.authorization.capabilityPolicyVersion !== 'beta-local-2' ||
    request.authorization.executionPolicyVersion !== 'beta-local-2' ||
    request.maxRequestBytes > MAX_ADMISSION_BYTES ||
    request.maxResponseBytes > MAX_ADMISSION_BYTES ||
    !SHA256.test(request.requestBindingSha256) ||
    (request.credentialBinding !== 'none' && !SHA256.test(request.credentialBinding)) ||
    (request.requestBodySha256 !== null && !SHA256.test(request.requestBodySha256)) ||
    (request.requestBodyBytes === 0) !== (request.requestBodySha256 === null)
  ) {
    return 'malformed_request'
  }
  if (
    !Number.isSafeInteger(request.deadlineMs) ||
    request.deadlineMs <= nowMs ||
    request.deadlineMs > nowMs + 60_000
  ) {
    return 'deadline_exceeded'
  }
  if (request.requestBodyBytes > request.maxRequestBytes) return 'request_too_large'
  if (request.routeCatalogueVersion !== GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION) {
    return 'catalogue_mismatch'
  }
  const policy = GOOGLE_PROVIDER_ROUTE_POLICIES[request.routeKey]
  if (!policy) return 'route_mismatch'
  if (policy.endpointClass !== request.endpointClass) return 'endpoint_mismatch'
  if (policy.requestClass !== request.requestClass) {
    return 'request_class_mismatch'
  }
  if (
    policy.maxRequestBytes !== request.maxRequestBytes ||
    policy.maxResponseBytes !== request.maxResponseBytes ||
    policy.quotaPolicyId !== request.quotaPolicyId ||
    policy.inFlightPolicyId !== request.inFlightPolicyId
  ) {
    return 'quota_policy_mismatch'
  }
  return null
}

function sameAuthorization(
  left: GoogleAuthorizationVector,
  right: GoogleAuthorizationVector,
): boolean {
  return (
    left.lifecycleVersion === right.lifecycleVersion &&
    left.accessVersion === right.accessVersion &&
    left.credentialGeneration === right.credentialGeneration &&
    left.propertyAuthorizationGeneration === right.propertyAuthorizationGeneration &&
    left.capabilityPolicyVersion === right.capabilityPolicyVersion &&
    left.executionPolicyVersion === right.executionPolicyVersion &&
    left.routingPolicyVersion === right.routingPolicyVersion
  )
}

export function compareGoogleExecutionAdmissionRequest(
  issued: GoogleExecutionPermit,
  actual: GoogleExecutionAdmissionRequest,
): GoogleAdmissionDenyCode | null {
  if (
    issued.organizationId !== actual.organizationId ||
    issued.propertyId !== actual.propertyId ||
    issued.connectionId !== actual.connectionId ||
    issued.capability !== actual.capability ||
    !sameAuthorization(issued.authorization, actual.authorization)
  ) {
    return 'authorization_drift'
  }
  if (issued.routeKey !== actual.routeKey) return 'route_mismatch'
  if (issued.routeCatalogueVersion !== actual.routeCatalogueVersion) {
    return 'catalogue_mismatch'
  }
  if (issued.endpointClass !== actual.endpointClass) return 'endpoint_mismatch'
  if (issued.requestClass !== actual.requestClass) {
    return 'request_class_mismatch'
  }
  if (issued.requestBindingSha256 !== actual.requestBindingSha256) {
    return 'request_binding_mismatch'
  }
  if (issued.credentialBinding !== actual.credentialBinding) {
    return 'credential_mismatch'
  }
  if (
    issued.requestBodySha256 !== actual.requestBodySha256 ||
    issued.requestBodyBytes !== actual.requestBodyBytes
  ) {
    return 'body_mismatch'
  }
  if (
    issued.maxRequestBytes !== actual.maxRequestBytes ||
    issued.maxResponseBytes !== actual.maxResponseBytes ||
    issued.quotaPolicyId !== actual.quotaPolicyId ||
    issued.inFlightPolicyId !== actual.inFlightPolicyId
  ) {
    return 'quota_policy_mismatch'
  }
  return null
}

export function createDenyAllGoogleExecutionAdmission(): GoogleExecutionAdmission {
  const denial = Object.freeze({
    ok: false as const,
    code: 'denied_by_default' as const,
  })
  return Object.freeze({
    issue: async () => denial,
    consume: async () => denial,
  })
}

export function createInMemoryGoogleExecutionAdmission(
  deps: Readonly<{
    nowMs: () => number
    idGen: () => string
    authorize: (request: GoogleExecutionAdmissionRequest) => boolean
  }>,
): GoogleExecutionAdmission {
  const permits = new Map<string, { permit: GoogleExecutionPermit; consumed: boolean }>()
  return Object.freeze({
    issue: async (request) => {
      const nowMs = deps.nowMs()
      const invalid = validateGoogleExecutionAdmissionRequest(request, nowMs)
      if (invalid) return { ok: false, code: invalid }
      if (!deps.authorize(request)) return { ok: false, code: 'denied_by_default' }
      const permit: GoogleExecutionPermit = Object.freeze({
        ...request,
        authorization: Object.freeze({ ...request.authorization }),
        permitId: deps.idGen(),
        issuedAtMs: nowMs,
        expiresAtMs: Math.min(request.deadlineMs, nowMs + 30_000),
      })
      if (permits.has(permit.permitId)) {
        return { ok: false, code: 'denied_by_default' }
      }
      permits.set(permit.permitId, { permit, consumed: false })
      return { ok: true, value: permit }
    },
    consume: async (permit, actual) => {
      const stored = permits.get(permit.permitId)
      if (!stored) return { ok: false, code: 'permit_unknown' }
      if (stored.consumed) return { ok: false, code: 'permit_replayed' }
      if (stored.permit !== permit) return { ok: false, code: 'permit_unknown' }
      const nowMs = deps.nowMs()
      if (stored.permit.expiresAtMs <= nowMs || actual.deadlineMs <= nowMs) {
        stored.consumed = true
        return { ok: false, code: 'permit_expired' }
      }
      const invalid = validateGoogleExecutionAdmissionRequest(actual, nowMs)
      if (invalid) return { ok: false, code: invalid }
      const mismatchCode = compareGoogleExecutionAdmissionRequest(stored.permit, actual)
      if (mismatchCode) return { ok: false, code: mismatchCode }
      stored.consumed = true
      return { ok: true, value: stored.permit }
    },
  })
}
