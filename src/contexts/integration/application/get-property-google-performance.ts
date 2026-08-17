import type { AuthContext } from '#/shared/domain/auth-context'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { ProviderAuthorizationLeaseResult } from '#/shared/provider-ephemeral/authorization-lease'
import type {
  PropertyGooglePerformanceResultV1,
  PropertyPerformancePreset,
} from '#/shared/google-performance-report-contract'
import type { GooglePerformanceSourcePort } from './google-provider-contract'
import {
  buildPropertyPerformancePeriod,
  composePropertyGooglePerformanceReport,
  GooglePerformanceReportError,
} from './google-performance-report'
import { isGbpApiError } from '../domain/gbp-api-error'

const CONTENT_TTL_MS = 15 * 60_000

export type GooglePerformanceAuthorizationSnapshot = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  locationId: string
  timezone: string
  sourceEpoch: number
  profileVersion: number
  connectionLifecycleVersion: number
  connectionAccessVersion: number
  credentialGeneration: number
  approvalBindingId: string
  authorizationVector: Readonly<Record<string, string | number | boolean | null>>
  authorizationVectorSha256: string
  principalHmacKeyVersion: string
  principalHmac: string
}>

type UnavailablePerformanceResult = Exclude<
  PropertyGooglePerformanceResultV1,
  { status: 'ready' }
>

export type GooglePerformanceAuthorizationResult =
  | Readonly<{
      ok: true
      snapshot: GooglePerformanceAuthorizationSnapshot
      accessToken: string | null
    }>
  | Readonly<{ ok: false; result: UnavailablePerformanceResult }>

export type GooglePerformanceAuthorizer = (
  input: Readonly<{
    actor: AuthContext
    propertyId: PropertyId
    phase: 'before_provider' | 'before_return'
    expected?: GooglePerformanceAuthorizationSnapshot
    requireAccessToken?: boolean
  }>,
) => Promise<GooglePerformanceAuthorizationResult>

export type GetPropertyGooglePerformance = (
  input: Readonly<{
    propertyId: PropertyId
    preset: PropertyPerformancePreset
    actor: AuthContext
    signal?: AbortSignal
  }>,
) => Promise<PropertyGooglePerformanceResultV1>

type FetchPerformance = (
  input: Parameters<GooglePerformanceSourcePort['fetchReport']>[0],
  actor: AuthContext,
  snapshot: GooglePerformanceAuthorizationSnapshot,
  accessToken: string,
) => ReturnType<GooglePerformanceSourcePort['fetchReport']>

type IssuePerformanceLease = (
  input: Readonly<{
    actor: AuthContext
    snapshot: GooglePerformanceAuthorizationSnapshot
    absoluteDeadlineMs: number
    nowMs: number
  }>,
) => Promise<ProviderAuthorizationLeaseResult>

function errorResult(
  errorCode: Extract<PropertyGooglePerformanceResultV1, { status: 'error' }>['errorCode'],
  retryable: boolean,
  retryAfterSeconds: number | null = null,
): Extract<PropertyGooglePerformanceResultV1, { status: 'error' }> {
  return Object.freeze({ status: 'error', errorCode, retryable, retryAfterSeconds })
}

function mapProviderError(error: unknown): UnavailablePerformanceResult {
  if (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  ) {
    return errorResult('provider_timeout', true)
  }
  if (error instanceof GooglePerformanceReportError) {
    return errorResult('stale_source', true)
  }
  if (!isGbpApiError(error)) return errorResult('temporarily_unavailable', true)
  switch (error.kind) {
    case 'rate_limited':
      return errorResult(
        'rate_limited',
        true,
        error.retryAfterMs === null
          ? null
          : Math.max(1, Math.ceil(error.retryAfterMs / 1_000)),
      )
    case 'parse_error':
      return errorResult('malformed_provider_response', false)
    case 'auth_failed':
    case 'permission_denied':
      return errorResult('provider_rejected', false)
    case 'upstream_error':
      return errorResult('temporarily_unavailable', true)
  }
}

function sameAuthorizationVectorExceptCredentialGeneration(
  current: GooglePerformanceAuthorizationSnapshot['authorizationVector'],
  expected: GooglePerformanceAuthorizationSnapshot['authorizationVector'],
): boolean {
  const currentKeys = Object.keys(current).sort()
  const expectedKeys = Object.keys(expected).sort()
  return (
    currentKeys.length === expectedKeys.length &&
    currentKeys.every(
      (key, index) =>
        key === expectedKeys[index] &&
        (key === 'credentialGeneration' || current[key] === expected[key]),
    )
  )
}

function sameSnapshot(
  current: GooglePerformanceAuthorizationSnapshot,
  expected: GooglePerformanceAuthorizationSnapshot,
): boolean {
  return (
    current.organizationId === expected.organizationId &&
    current.propertyId === expected.propertyId &&
    current.connectionId === expected.connectionId &&
    current.locationId === expected.locationId &&
    current.timezone === expected.timezone &&
    current.sourceEpoch === expected.sourceEpoch &&
    current.profileVersion === expected.profileVersion &&
    current.connectionLifecycleVersion === expected.connectionLifecycleVersion &&
    current.connectionAccessVersion === expected.connectionAccessVersion &&
    current.approvalBindingId === expected.approvalBindingId &&
    sameAuthorizationVectorExceptCredentialGeneration(
      current.authorizationVector,
      expected.authorizationVector,
    ) &&
    current.principalHmacKeyVersion === expected.principalHmacKeyVersion &&
    current.principalHmac === expected.principalHmac
  )
}

export function createGetPropertyGooglePerformance(
  deps: Readonly<{
    authorize: GooglePerformanceAuthorizer
    fetchReport: FetchPerformance
    issueLease: IssuePerformanceLease
    clock: () => Date
    monotonicNowMs?: () => number
  }>,
): GetPropertyGooglePerformance {
  const monotonicNowMs = deps.monotonicNowMs ?? performance.now.bind(performance)
  return async (input) => {
    const deadlineAtMs = monotonicNowMs() + 15_000
    let initial: GooglePerformanceAuthorizationResult
    try {
      initial = await deps.authorize({
        actor: input.actor,
        propertyId: input.propertyId,
        phase: 'before_provider',
      })
    } catch {
      return errorResult('temporarily_unavailable', true)
    }
    if (!initial.ok) return initial.result
    if (initial.accessToken === null) return errorResult('temporarily_unavailable', true)

    const requestedAt = deps.clock()
    let period: ReturnType<typeof buildPropertyPerformancePeriod>
    try {
      period = buildPropertyPerformancePeriod({
        preset: input.preset,
        timezone: initial.snapshot.timezone,
        now: requestedAt,
      })
    } catch {
      return Object.freeze({
        status: 'unavailable',
        reason: 'timezone_required',
        action: 'set_timezone',
      })
    }

    let source: Awaited<ReturnType<GooglePerformanceSourcePort['fetchReport']>>
    try {
      const remainingMs = Math.max(1, Math.ceil(deadlineAtMs - monotonicNowMs()))
      const timeoutSignal = AbortSignal.timeout(remainingMs)
      const signal = input.signal
        ? AbortSignal.any([input.signal, timeoutSignal])
        : timeoutSignal
      source = await deps.fetchReport(
        {
          organizationId: initial.snapshot.organizationId,
          propertyId: initial.snapshot.propertyId,
          connectionId: initial.snapshot.connectionId,
          expectedConnectionLifecycleVersion: initial.snapshot.connectionLifecycleVersion,
          expectedConnectionAccessVersion: initial.snapshot.connectionAccessVersion,
          expectedCredentialGeneration: initial.snapshot.credentialGeneration,
          expectedSourceEpoch: initial.snapshot.sourceEpoch,
          locationId: initial.snapshot.locationId,
          startLocalDate: period.priorStartLocalDate,
          endLocalDate: period.currentEndLocalDate,
          signal,
        },
        input.actor,
        initial.snapshot,
        initial.accessToken,
      )
    } catch (error) {
      return mapProviderError(error)
    }
    if (monotonicNowMs() >= deadlineAtMs) return errorResult('provider_timeout', true)

    let refreshed: GooglePerformanceAuthorizationResult
    try {
      refreshed = await deps.authorize({
        actor: input.actor,
        propertyId: input.propertyId,
        phase: 'before_return',
      })
    } catch {
      return errorResult('temporarily_unavailable', true)
    }
    if (!refreshed.ok) return refreshed.result
    if (monotonicNowMs() >= deadlineAtMs) return errorResult('provider_timeout', true)
    if (!sameSnapshot(refreshed.snapshot, initial.snapshot)) {
      return errorResult('stale_source', true)
    }

    const retrievedAt = deps.clock()
    const contentExpiresAt = new Date(retrievedAt.getTime() + CONTENT_TTL_MS)
    let lease: ProviderAuthorizationLeaseResult
    try {
      lease = await deps.issueLease({
        actor: input.actor,
        snapshot: refreshed.snapshot,
        absoluteDeadlineMs: contentExpiresAt.getTime(),
        nowMs: retrievedAt.getTime(),
      })
    } catch {
      return errorResult('temporarily_unavailable', true)
    }
    if (!lease.ok) return errorResult('temporarily_unavailable', true)

    try {
      return Object.freeze({
        status: 'ready',
        data: composePropertyGooglePerformanceReport({
          source,
          preset: input.preset,
          timezone: refreshed.snapshot.timezone,
          retrievedAt,
          contentExpiresAt,
          authorizationLease: lease.lease,
        }),
      })
    } catch (error) {
      return mapProviderError(error)
    }
  }
}
