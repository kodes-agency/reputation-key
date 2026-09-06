import type { VersionedHmacKeyring } from '../security/versioned-hmac-keyring'
import type {
  GoogleInFlightCoordinator,
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
import {
  signGoogleAdmissionGrant,
  verifyGoogleAdmissionGrant,
  type GoogleAdmissionGrant,
  type GoogleAdmissionGrantRecord,
  type GoogleAdmissionGrantStore,
} from './admission-grant-store'

export type GoogleAdmissionPermitSnapshot = Readonly<{
  permitId: string
  kind: 'work' | 'credential_cleanup'
  gatewayIdentity: string
  routeKey: GoogleProviderRouteKey
  routeCatalogueVersion: typeof GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION
  expectedAdmission: GoogleProviderAdmissionMetadata
  quotaKey: GoogleQuotaKey
  expiresAtMs: number
  permitGeneration: number
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
  gatewayIdentity: string
  admission: GoogleProviderAdmissionMetadata
  deadlineMs: number
}>

export type GoogleAdmissionStartResult =
  | Readonly<{ ok: true; grant: GoogleAdmissionGrant }>
  | Readonly<{
      ok: false
      code:
        | 'malformed_request'
        | 'permit_unknown'
        | 'permit_expired'
        | 'gateway_mismatch'
        | 'route_mismatch'
        | 'request_mismatch'
        | 'quota_exhausted'
        | 'in_flight_exhausted'
        | 'coordination_unavailable'
        | 'authorization_changed'
        | 'grant_unavailable'
      retryAfterMs: number
    }>

export type GoogleAdmissionRedeemResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false
      code: 'grant_unknown' | 'grant_expired' | 'grant_replayed' | 'grant_mismatch'
    }>

export type GoogleExecutionAdmissionService = Readonly<{
  start(input: GoogleAdmissionStartInput): Promise<GoogleAdmissionStartResult>
  redeem(
    input: Readonly<{
      grant: GoogleAdmissionGrant
      gatewayIdentity: string
      admission: GoogleProviderAdmissionMetadata
    }>,
  ): Promise<GoogleAdmissionRedeemResult>
  complete(
    input: Readonly<{
      admissionId: string
      outcome: GoogleProviderOutcome
      retryAfterMs: number | null
    }>,
  ): Promise<boolean>
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
    !SAFE_ID.test(snapshot.gatewayIdentity) ||
    !SAFE_ID.test(snapshot.authorityRevision) ||
    !Number.isSafeInteger(snapshot.expiresAtMs) ||
    !validAdmissionMetadata(snapshot.expectedAdmission) ||
    snapshot.routeKey !== snapshot.expectedAdmission.routeKey ||
    !Number.isSafeInteger(snapshot.permitGeneration) ||
    snapshot.permitGeneration < 1 ||
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

function admissionRecord(
  grant: GoogleAdmissionGrant,
  permit: GoogleAdmissionPermitSnapshot,
  inFlightLease: GoogleAdmissionGrantRecord['inFlightLease'],
): GoogleAdmissionGrantRecord {
  return Object.freeze({
    grant,
    state: 'issued',
    quotaKey: permit.quotaKey,
    authorityRevision: permit.authorityRevision,
    inFlightKey: Object.freeze({
      ...permit.quotaKey,
      requestClass: permit.expectedAdmission.requestClass,
    }),
    inFlightLease,
  })
}

export function createGoogleExecutionAdmissionService(
  deps: Readonly<{
    nowMs: () => number
    admissionId: () => string
    grantKeyring: VersionedHmacKeyring
    grantStore: GoogleAdmissionGrantStore
    authority: GoogleAdmissionPermitAuthority
    quotaForPolicy: (policyId: string) => GoogleQuotaCoordinator | null
    inFlightForPolicy: (policyId: string) => GoogleInFlightCoordinator | null
  }>,
): GoogleExecutionAdmissionService {
  return Object.freeze({
    start: async (input) => {
      const nowMs = deps.nowMs()
      if (
        !SAFE_ID.test(input.permitId) ||
        !SAFE_ID.test(input.gatewayIdentity) ||
        !validAdmissionMetadata(input.admission) ||
        !Number.isSafeInteger(input.deadlineMs) ||
        input.deadlineMs <= nowMs ||
        input.deadlineMs > nowMs + 60_000
      ) {
        return { ok: false, code: 'malformed_request', retryAfterMs: 0 }
      }
      const permit = await deps.authority.load(input.permitId)
      if (!permit || !validPermitSnapshot(permit)) {
        return { ok: false, code: 'permit_unknown', retryAfterMs: 0 }
      }
      if (permit.expiresAtMs <= nowMs) {
        return { ok: false, code: 'permit_expired', retryAfterMs: 0 }
      }
      if (permit.gatewayIdentity !== input.gatewayIdentity) {
        return { ok: false, code: 'gateway_mismatch', retryAfterMs: 0 }
      }
      if (
        permit.routeKey !== input.admission.routeKey ||
        permit.routeCatalogueVersion !== input.admission.catalogueVersion
      ) {
        return { ok: false, code: 'route_mismatch', retryAfterMs: 0 }
      }
      if (!sameAdmissionMetadata(permit.expectedAdmission, input.admission)) {
        return { ok: false, code: 'request_mismatch', retryAfterMs: 0 }
      }
      const quota = deps.quotaForPolicy(permit.expectedAdmission.quotaPolicyId)
      const inFlight = deps.inFlightForPolicy(permit.expectedAdmission.inFlightPolicyId)
      if (!quota || !inFlight) {
        return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
      }
      const quotaResult = await quota.acquire(permit.quotaKey, 1, input.deadlineMs)
      if (!quotaResult.ok) {
        return {
          ok: false,
          code:
            quotaResult.code === 'quota_exhausted' ||
            quotaResult.code === 'deadline_exceeded'
              ? 'quota_exhausted'
              : 'coordination_unavailable',
          retryAfterMs: quotaResult.retryAfterMs,
        }
      }
      const inFlightKey = Object.freeze({
        ...permit.quotaKey,
        requestClass: permit.expectedAdmission.requestClass,
      })
      const inFlightResult = await inFlight.acquire(inFlightKey, input.deadlineMs)
      if (!inFlightResult.ok) {
        return {
          ok: false,
          code:
            inFlightResult.code === 'limit_exhausted' ||
            inFlightResult.code === 'deadline_exceeded'
              ? 'in_flight_exhausted'
              : 'coordination_unavailable',
          retryAfterMs: inFlightResult.retryAfterMs,
        }
      }
      const started = await deps.authority.start(permit)
      if (started !== 'started') {
        await inFlight.release(inFlightKey, inFlightResult.lease)
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
      const expiresAtMs = Math.min(permit.expiresAtMs, input.deadlineMs, nowMs + 30_000)
      if (expiresAtMs <= nowMs) {
        await deps.authority.failStarted(permit, 'grant_expired')
        await inFlight.release(inFlightKey, inFlightResult.lease)
        return { ok: false, code: 'permit_expired', retryAfterMs: 0 }
      }
      const grant = signGoogleAdmissionGrant(
        {
          admissionId: deps.admissionId(),
          permitId: permit.permitId,
          routeKey: permit.routeKey,
          routeCatalogueVersion: permit.routeCatalogueVersion,
          gatewayIdentity: permit.gatewayIdentity,
          requestBindingSha256: input.admission.requestBindingSha256,
          credentialBinding: input.admission.credentialBinding,
          expiresAtMs,
        },
        deps.grantKeyring,
      )
      const issued = await deps.grantStore.issue(
        admissionRecord(grant, permit, inFlightResult.lease),
      )
      if (!issued) {
        await deps.authority.failStarted(permit, 'grant_unavailable')
        await inFlight.release(inFlightKey, inFlightResult.lease)
        return { ok: false, code: 'grant_unavailable', retryAfterMs: 0 }
      }
      return { ok: true, grant }
    },

    redeem: async (input) => {
      const nowMs = deps.nowMs()
      if (
        !verifyGoogleAdmissionGrant(input.grant, deps.grantKeyring) ||
        input.grant.gatewayIdentity !== input.gatewayIdentity ||
        input.grant.routeKey !== input.admission.routeKey ||
        input.grant.routeCatalogueVersion !== input.admission.catalogueVersion ||
        input.grant.requestBindingSha256 !== input.admission.requestBindingSha256 ||
        input.grant.credentialBinding !== input.admission.credentialBinding
      ) {
        return { ok: false, code: 'grant_mismatch' }
      }
      if (input.grant.expiresAtMs <= nowMs) {
        return { ok: false, code: 'grant_expired' }
      }
      const redeemed = await deps.grantStore.redeem(
        input.grant.admissionId,
        input.grant.signature,
        nowMs,
      )
      if (redeemed === 'expired') return { ok: false, code: 'grant_expired' }
      if (redeemed === 'replayed') return { ok: false, code: 'grant_replayed' }
      if (redeemed === 'mismatch') return { ok: false, code: 'grant_mismatch' }
      if (redeemed === 'unknown') return { ok: false, code: 'grant_unknown' }
      return { ok: true }
    },

    complete: async (input) => {
      if (
        !SAFE_ID.test(input.admissionId) ||
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
            input.retryAfterMs > 300_000))
      ) {
        return false
      }
      const record = await deps.grantStore.complete(input.admissionId)
      if (!record) return false
      const inFlight = deps.inFlightForPolicy(
        GOOGLE_PROVIDER_ROUTE_POLICIES[record.grant.routeKey].inFlightPolicyId,
      )
      await inFlight?.release(record.inFlightKey, record.inFlightLease)
      try {
        await deps.authority.complete(
          record.grant.permitId,
          record.authorityRevision,
          input.outcome,
          input.retryAfterMs,
        )
        return true
      } catch {
        return false
      }
    },
  })
}
