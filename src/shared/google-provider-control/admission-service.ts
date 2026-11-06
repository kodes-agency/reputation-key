import type {
  GoogleInFlightCoordinator,
  GoogleInFlightLease,
  GoogleProviderRouteKey,
  GoogleQuotaCoordinator,
  GoogleQuotaKey,
} from './contracts'
import { googleQuotaCredentialFingerprint } from './quota-coordinator'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_POLICIES,
  type GoogleProviderAdmissionMetadata,
} from './route-catalogue'
export type GoogleAdmissionPermitSnapshot = Readonly<{
  permitId: string
  kind: 'work' | 'credential_cleanup'
  routeKey: GoogleProviderRouteKey
  routeCatalogueVersion: typeof GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION
  expectedAdmission: GoogleProviderAdmissionMetadata
  quotaKey: GoogleQuotaKey
  expiresAtMs: number
  authorityRevision: string
}>

export type GoogleAdmissionPermitAuthority = Readonly<{
  load(permitId: string): Promise<GoogleAdmissionPermitSnapshot | null>
  start(
    permit: GoogleAdmissionPermitSnapshot,
  ): Promise<'started' | 'changed' | 'expired' | 'unavailable'>
  failStarted(
    permit: GoogleAdmissionPermitSnapshot,
    code: 'grant_unavailable' | 'grant_expired',
  ): Promise<void>
  complete(
    permitId: string,
    authorityRevision: string,
    outcome: GoogleProviderOutcome,
    retryAfterMs: number | null,
  ): Promise<void>
}>

export type GoogleProviderOutcome =
  | 'success'
  | 'provider_4xx'
  | 'provider_5xx'
  | 'rate_limited'
  | 'deadline_exceeded'
  | 'transport_error'
  | 'response_too_large'
  | 'caller_abandoned'

export type GoogleAdmissionStartInput = Readonly<{
  permitId: string
  admission: GoogleProviderAdmissionMetadata
  deadlineMs: number
}>

export type GoogleAdmissionStartResult =
  | Readonly<{ ok: true; handle: GoogleAdmissionHandle }>
  | Readonly<{
      ok: false
      code:
        | 'malformed_request'
        /** The start deadline had already elapsed; nothing about the request is wrong. */
        | 'deadline_exceeded'
        | 'permit_unknown'
        | 'permit_expired'
        | 'route_mismatch'
        | 'request_mismatch'
        | 'quota_exhausted'
        | 'in_flight_exhausted'
        | 'coordination_unavailable'
        | 'authorization_changed'
      retryAfterMs: number
    }>

type GoogleAdmissionCompletion = Readonly<{
  outcome: GoogleProviderOutcome
  retryAfterMs: number | null
}>

/** A local capability: only admission can bind it to a started permit. */
export type GoogleAdmissionHandle = Readonly<{
  expiresAtMs: number
  /** Resolves after the durable outcome is recorded, independently of lease release. */
  permitCompletion: Promise<void>
  complete(input: GoogleAdmissionCompletion): Promise<boolean>
}>

export type GoogleExecutionAdmissionService = Readonly<{
  start(input: GoogleAdmissionStartInput): Promise<GoogleAdmissionStartResult>
}>

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/

function sameAdmissionMetadata(
  expected: GoogleProviderAdmissionMetadata,
  actual: GoogleProviderAdmissionMetadata,
): boolean {
  return (
    expected.routeKey === actual.routeKey &&
    expected.catalogueVersion === actual.catalogueVersion &&
    expected.endpointClass === actual.endpointClass &&
    expected.requestClass === actual.requestClass &&
    expected.requestBindingSha256 === actual.requestBindingSha256 &&
    expected.credentialBinding === actual.credentialBinding &&
    expected.requestBodySha256 === actual.requestBodySha256 &&
    expected.requestBodyBytes === actual.requestBodyBytes &&
    expected.maxRequestBytes === actual.maxRequestBytes &&
    expected.maxResponseBytes === actual.maxResponseBytes &&
    expected.quotaPolicyId === actual.quotaPolicyId &&
    expected.inFlightPolicyId === actual.inFlightPolicyId
  )
}

function validAdmissionMetadata(metadata: GoogleProviderAdmissionMetadata): boolean {
  const policy = GOOGLE_PROVIDER_ROUTE_POLICIES[metadata.routeKey]
  return (
    metadata.catalogueVersion === GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION &&
    policy !== undefined &&
    metadata.endpointClass === policy.endpointClass &&
    metadata.requestClass === policy.requestClass &&
    metadata.maxRequestBytes === policy.maxRequestBytes &&
    metadata.maxResponseBytes === policy.maxResponseBytes &&
    metadata.quotaPolicyId === policy.quotaPolicyId &&
    metadata.inFlightPolicyId === policy.inFlightPolicyId &&
    SHA256.test(metadata.requestBindingSha256) &&
    (metadata.credentialBinding === 'none' || SHA256.test(metadata.credentialBinding)) &&
    (metadata.requestBodySha256 === null || SHA256.test(metadata.requestBodySha256)) &&
    Number.isSafeInteger(metadata.requestBodyBytes) &&
    metadata.requestBodyBytes >= 0 &&
    metadata.requestBodyBytes <= metadata.maxRequestBytes &&
    (metadata.requestBodyBytes === 0) === (metadata.requestBodySha256 === null)
  )
}

function validPermitSnapshot(snapshot: GoogleAdmissionPermitSnapshot): boolean {
  if (
    !SAFE_ID.test(snapshot.permitId) ||
    !SAFE_ID.test(snapshot.authorityRevision) ||
    !Number.isSafeInteger(snapshot.expiresAtMs) ||
    !validAdmissionMetadata(snapshot.expectedAdmission) ||
    snapshot.routeKey !== snapshot.expectedAdmission.routeKey ||
    snapshot.routeCatalogueVersion !== snapshot.expectedAdmission.catalogueVersion ||
    snapshot.quotaKey.endpointClass !== snapshot.expectedAdmission.endpointClass ||
    snapshot.quotaKey.credentialFingerprint !==
      googleQuotaCredentialFingerprint(
        snapshot.expectedAdmission.credentialBinding,
        snapshot.quotaKey.projectFingerprint,
      ) ||
    !SHA256.test(snapshot.quotaKey.projectFingerprint)
  ) {
    return false
  }
  return snapshot.kind === 'credential_cleanup'
    ? snapshot.routeKey === 'oauth.revoke'
    : snapshot.routeKey !== 'oauth.revoke'
}

function createAdmissionHandle(
  permit: GoogleAdmissionPermitSnapshot,
  expiresAtMs: number,
  lease: GoogleInFlightLease,
  inFlight: GoogleInFlightCoordinator,
  authority: GoogleAdmissionPermitAuthority,
): GoogleAdmissionHandle {
  const key = { ...permit.quotaKey, requestClass: permit.expectedAdmission.requestClass }
  let completion: GoogleAdmissionCompletion | undefined
  let pending: Promise<boolean> | undefined
  let permitCompleted = false
  let released = false
  const { promise: permitCompletion, resolve: markPermitCompleted } =
    Promise.withResolvers<void>()
  return Object.freeze({
    expiresAtMs,
    permitCompletion,
    complete: (input: GoogleAdmissionCompletion): Promise<boolean> => {
      if (
        ![
          'success',
          'provider_4xx',
          'provider_5xx',
          'rate_limited',
          'deadline_exceeded',
          'transport_error',
          'response_too_large',
          'caller_abandoned',
        ].includes(input.outcome) ||
        (input.retryAfterMs !== null &&
          (!Number.isSafeInteger(input.retryAfterMs) ||
            input.retryAfterMs < 0 ||
            input.retryAfterMs > 300_000)) ||
        (completion !== undefined &&
          (completion.outcome !== input.outcome ||
            completion.retryAfterMs !== input.retryAfterMs))
      )
        return Promise.resolve(false)
      completion ??= Object.freeze({ ...input })
      if (pending) return pending
      const recorded = completion
      pending = (async () => {
        if (!permitCompleted) {
          try {
            await authority.complete(
              permit.permitId,
              permit.authorityRevision,
              recorded.outcome,
              recorded.retryAfterMs,
            )
            permitCompleted = true
            markPermitCompleted()
          } catch {
            // The durable permit sweep fences anything left after bounded retries.
          }
        }
        if (!released) {
          try {
            released = await inFlight.release(key, lease)
          } catch {
            // The Redis lease still expires if its release cannot be recorded.
          }
        }
        return permitCompleted && released
      })().finally(() => {
        pending = undefined
      })
      return pending
    },
  })
}

type AdmissionDenial = Extract<GoogleAdmissionStartResult, { ok: false }>

function permitDenial(
  permit: GoogleAdmissionPermitSnapshot,
  admission: GoogleProviderAdmissionMetadata,
  nowMs: number,
): AdmissionDenial | null {
  if (permit.expiresAtMs <= nowMs) {
    return { ok: false, code: 'permit_expired', retryAfterMs: 0 }
  }
  if (
    permit.routeKey !== admission.routeKey ||
    permit.routeCatalogueVersion !== admission.catalogueVersion
  ) {
    return { ok: false, code: 'route_mismatch', retryAfterMs: 0 }
  }
  if (!sameAdmissionMetadata(permit.expectedAdmission, admission)) {
    return { ok: false, code: 'request_mismatch', retryAfterMs: 0 }
  }
  return null
}

/** An elapsed deadline differs from capacity whose next availability is too late. */
function capacityDenial(
  result: Readonly<{ code: string; retryAfterMs: number }>,
  exhaustedCode: 'quota_exhausted' | 'in_flight_exhausted',
  deadlineMs: number,
  nowMs: () => number,
): AdmissionDenial {
  let code: AdmissionDenial['code'] = 'coordination_unavailable'
  if (result.code === 'deadline_exceeded') {
    code =
      result.retryAfterMs === 0 || deadlineMs <= nowMs()
        ? 'deadline_exceeded'
        : exhaustedCode
  } else if (
    result.code ===
    (exhaustedCode === 'quota_exhausted' ? 'quota_exhausted' : 'limit_exhausted')
  ) {
    code = exhaustedCode
  }
  return { ok: false, code, retryAfterMs: result.retryAfterMs }
}

type AdmissionDependencies = Readonly<{
  nowMs: () => number
  authority: GoogleAdmissionPermitAuthority
  quotaForPolicy: (policyId: string) => GoogleQuotaCoordinator | null
  inFlightForPolicy: (policyId: string) => GoogleInFlightCoordinator | null
}>

/** Start the permit without crediting quota that may already have refilled. */
async function startReservedPermit(
  deps: AdmissionDependencies,
  permit: GoogleAdmissionPermitSnapshot,
  deadlineMs: number,
  capacity: Readonly<{
    inFlight: GoogleInFlightCoordinator
    lease: GoogleInFlightLease
  }>,
): Promise<GoogleAdmissionStartResult> {
  const { inFlight, lease } = capacity
  const inFlightKey = Object.freeze({
    ...permit.quotaKey,
    requestClass: permit.expectedAdmission.requestClass,
  })
  let started: Awaited<ReturnType<GoogleAdmissionPermitAuthority['start']>>
  try {
    started = await deps.authority.start(permit)
  } catch {
    started = 'unavailable'
  }
  if (started !== 'started') {
    await Promise.allSettled([inFlight.release(inFlightKey, lease)])
    return {
      ok: false,
      code:
        started === 'expired'
          ? 'permit_expired'
          : started === 'changed'
            ? 'authorization_changed'
            : 'coordination_unavailable',
      retryAfterMs: 0,
    }
  }
  // Waiting for capacity and starting the permit both spend the deadline.
  const grantedAtMs = deps.nowMs()
  const expiresAtMs = Math.min(permit.expiresAtMs, deadlineMs, grantedAtMs + 30_000)
  if (expiresAtMs <= grantedAtMs) {
    await Promise.allSettled([
      deps.authority.failStarted(permit, 'grant_expired'),
      inFlight.release(inFlightKey, lease),
    ])
    return {
      ok: false,
      code: deadlineMs <= grantedAtMs ? 'deadline_exceeded' : 'permit_expired',
      retryAfterMs: 0,
    }
  }
  return {
    ok: true,
    handle: createAdmissionHandle(permit, expiresAtMs, lease, inFlight, deps.authority),
  }
}

export function createGoogleExecutionAdmissionService(
  deps: AdmissionDependencies,
): GoogleExecutionAdmissionService {
  return Object.freeze({
    start: async (input) => {
      const nowMs = deps.nowMs()
      if (
        !SAFE_ID.test(input.permitId) ||
        !validAdmissionMetadata(input.admission) ||
        !Number.isSafeInteger(input.deadlineMs) ||
        input.deadlineMs > nowMs + 60_000
      ) {
        return { ok: false, code: 'malformed_request', retryAfterMs: 0 }
      }
      // Distinct from `malformed_request`, which callers treat as deterministic:
      // the gateway checked this deadline before the call, and only the time
      // spent reaching admission used it up.
      if (input.deadlineMs <= nowMs) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      const permit = await deps.authority.load(input.permitId)
      if (!permit || !validPermitSnapshot(permit)) {
        return { ok: false, code: 'permit_unknown', retryAfterMs: 0 }
      }
      const denial = permitDenial(permit, input.admission, nowMs)
      if (denial) return denial
      // Reading the permit takes time too. A deadline it used up is reported as
      // elapsed here: past this point the quota step answers "too late" as
      // `quota_exhausted`, which blamed quota for a stalled refresh (#946).
      if (input.deadlineMs <= deps.nowMs()) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      const quota = deps.quotaForPolicy(permit.expectedAdmission.quotaPolicyId)
      const inFlight = deps.inFlightForPolicy(permit.expectedAdmission.inFlightPolicyId)
      if (!quota || !inFlight) {
        return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
      }
      const inFlightKey = Object.freeze({
        ...permit.quotaKey,
        requestClass: permit.expectedAdmission.requestClass,
      })
      const inFlightResult = await inFlight.acquire(inFlightKey, input.deadlineMs)
      if (!inFlightResult.ok) {
        return capacityDenial(
          inFlightResult,
          'in_flight_exhausted',
          input.deadlineMs,
          deps.nowMs,
        )
      }
      const quotaResult = await quota.acquire(permit.quotaKey, 1, input.deadlineMs)
      if (!quotaResult.ok) {
        await inFlight.release(inFlightKey, inFlightResult.lease)
        return capacityDenial(
          quotaResult,
          'quota_exhausted',
          input.deadlineMs,
          deps.nowMs,
        )
      }
      return startReservedPermit(deps, permit, input.deadlineMs, {
        inFlight,
        lease: inFlightResult.lease,
      })
    },
  })
}
