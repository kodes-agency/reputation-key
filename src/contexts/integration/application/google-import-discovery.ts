import type { AuthContext } from '#/shared/domain/auth-context'
import {
  googleConnectionId,
  organizationId,
  type GoogleConnectionId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'
import { isGbpApiError } from '../domain/gbp-api-error'
import type {
  GbpLocationCandidate,
  GoogleAccountManagementPort,
  GoogleBusinessInformationPort,
} from './google-provider-contract'
import type {
  ImportAccountPageDto,
  ImportCandidatePageDto,
} from './google-import-v2-contract'
import type {
  GoogleImportReferenceStore,
  ImportDiscoveryAuthorization,
  ImportDiscoveryCandidate,
  ImportReferenceResult,
} from './ports/google-import-reference-store.port'

/** Durable pre-confirmation checkpoint window; current authorization is still
 * revalidated on every page, lease renewal, and confirmation claim. */
export const GOOGLE_IMPORT_DISCOVERY_CONTENT_TTL_MS = 24 * 60 * 60_000

export type GoogleImportAuthorizationPropertySnapshot = Readonly<{
  propertyId: PropertyId
  sourceEpoch: number
  profileVersion: number
  action: 'property.read' | 'property.update'
}>

export type GoogleImportCommandAuthorizationResult =
  | Readonly<{
      ok: true
      authorization: ImportDiscoveryAuthorization
      accessToken: string | null
    }>
  | Readonly<{
      ok: false
      code:
        | 'authorization_denied'
        | 'authorization_changed'
        | 'connection_unavailable'
        | 'runtime_unavailable'
    }>

/**
 * The one command-authorization seam for import discovery and lease renewal.
 * Implementations re-read current policy, membership, permissions, connection
 * visibility/lifecycle/generations, and supplied Property generations.
 */
export type GoogleImportCommandAuthorizer = (
  input: Readonly<{
    actor: AuthContext
    connectionId: GoogleConnectionId
    phase: 'provider_call' | 'publish' | 'lease_renewal'
    expected?: ImportDiscoveryAuthorization
    properties?: readonly GoogleImportAuthorizationPropertySnapshot[]
    requireAccessToken: boolean
  }>,
) => Promise<GoogleImportCommandAuthorizationResult>

export type GoogleImportPropertyClassifier = (
  input: Readonly<{
    actor: AuthContext
    connectionId: GoogleConnectionId
    candidates: readonly GbpLocationCandidate[]
  }>,
) => Promise<readonly ImportDiscoveryCandidate[]>

export type GoogleImportDiscoveryErrorCode =
  | 'unauthorized'
  | 'invalid_request'
  | 'reference_invalid'
  /** The stored Google credential no longer authenticates. Reconnect required. */
  | 'reauthentication_required'
  /** Google refused the call for this account. Retrying cannot succeed. */
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'temporarily_unavailable'

export class GoogleImportDiscoveryError extends Error {
  readonly code: GoogleImportDiscoveryErrorCode

  constructor(code: GoogleImportDiscoveryErrorCode) {
    super(`Google import discovery failed: ${code}`)
    this.name = 'GoogleImportDiscoveryError'
    this.code = code
  }
}

function deny(code: GoogleImportDiscoveryErrorCode): never {
  throw new GoogleImportDiscoveryError(code)
}

/**
 * Provider failures are classified, never collapsed. The adapter boundary has
 * already separated a permanent denial from a transient outage, so presenting an
 * expired credential or a refused account as "temporarily unavailable" would send
 * the operator into an endless retry loop with no actionable next step.
 */
function providerDenialCode(error: unknown): GoogleImportDiscoveryErrorCode {
  if (!isGbpApiError(error)) return 'provider_unavailable'
  switch (error.kind) {
    case 'auth_failed':
      return 'reauthentication_required'
    case 'permission_denied':
      return 'provider_rejected'
    case 'rate_limited':
    case 'upstream_error':
    case 'parse_error':
      return 'provider_unavailable'
  }
}

function sameAuthorization(
  actual: ImportDiscoveryAuthorization,
  expected: ImportDiscoveryAuthorization,
): boolean {
  const actualVector = JSON.stringify(
    Object.fromEntries(
      Object.entries(actual.authorizationVector).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  )
  const expectedVector = JSON.stringify(
    Object.fromEntries(
      Object.entries(expected.authorizationVector).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  )
  return (
    actual.organizationId === expected.organizationId &&
    actual.userId === expected.userId &&
    actual.connectionId === expected.connectionId &&
    actual.connectionLifecycleVersion === expected.connectionLifecycleVersion &&
    actual.connectionAccessVersion === expected.connectionAccessVersion &&
    actual.approvalBindingId === expected.approvalBindingId &&
    actual.credentialGeneration === expected.credentialGeneration &&
    actualVector === expectedVector
  )
}

function unwrapReference<T>(
  result: ImportReferenceResult<T>,
): Readonly<{ ok: true } & T> {
  if ('code' in result) {
    if (result.code === 'capacity_exceeded' || result.code === 'runtime_unavailable') {
      return deny('temporarily_unavailable')
    }
    return deny('reference_invalid')
  }
  return result as Readonly<{ ok: true } & T>
}

function propertySnapshots(
  candidates: readonly ImportDiscoveryCandidate[],
): readonly GoogleImportAuthorizationPropertySnapshot[] {
  const byProperty = new Map<string, GoogleImportAuthorizationPropertySnapshot>()
  for (const candidate of candidates) {
    const propertyId =
      candidate.eligibility.kind === 'relink' ||
      candidate.eligibility.kind === 'already_imported'
        ? candidate.eligibility.propertyId
        : candidate.affectedPropertyId
    if (!propertyId) continue
    const sourceEpoch = candidate.expectedSourceEpoch
    const profileVersion = candidate.expectedProfileVersion
    const action =
      candidate.eligibility.kind === 'relink'
        ? 'property.update'
        : candidate.eligibility.kind === 'already_imported' ||
            candidate.eligibility.kind === 'active_binding_conflict'
          ? 'property.read'
          : null
    if (
      action === null ||
      sourceEpoch === null ||
      sourceEpoch === undefined ||
      profileVersion === null ||
      profileVersion === undefined
    ) {
      continue
    }
    byProperty.set(propertyId, {
      propertyId: propertyId as PropertyId,
      sourceEpoch,
      profileVersion,
      action,
    })
  }
  return [...byProperty.values()]
}

function classificationsMatch(
  source: readonly GbpLocationCandidate[],
  classified: readonly ImportDiscoveryCandidate[],
): boolean {
  if (source.length !== classified.length) return false
  return source.every((candidate, index) => {
    const result = classified[index]
    return (
      result !== undefined &&
      result.accountId === candidate.binding.accountId &&
      result.locationId === candidate.binding.locationId &&
      result.accountDisplayName === candidate.accountDisplayName &&
      result.businessName === candidate.businessName &&
      result.address === candidate.address &&
      result.primaryCategory === candidate.primaryCategory &&
      result.countryCode === candidate.countryCode &&
      result.googleReviewUri === (candidate.googleReviewUri ?? null)
    )
  })
}

export function createGoogleImportDiscovery(
  deps: Readonly<{
    authorizeGoogleImportCommand: GoogleImportCommandAuthorizer
    classifyCandidates: GoogleImportPropertyClassifier
    references: GoogleImportReferenceStore
    accounts: GoogleAccountManagementPort
    locations: GoogleBusinessInformationPort
    nowMs?: () => number
    /**
     * Content-free denial logging. Discovery collapses provider, classifier and
     * reference failures into one client-safe code, so without this the only
     * signal is "could not load this content" with no diagnosable reason.
     */
    logger?: Readonly<{
      warn: (fields: Readonly<Record<string, unknown>>, message: string) => void
    }>
  }>,
) {
  const nowMs = deps.nowMs ?? Date.now

  /**
   * One content-free denial path for both provider calls: log the adapter's exact
   * classification, then surface the matching client code.
   */
  const denyProviderFailure = (
    stage: 'provider_accounts' | 'provider_locations',
    error: unknown,
  ): never => {
    const code = providerDenialCode(error)
    deps.logger?.warn(
      {
        stage,
        code,
        reason: error instanceof Error ? error.name : 'unknown',
        ...(isGbpApiError(error) ? { kind: error.kind } : {}),
      },
      'Google import discovery denied',
    )
    return deny(code)
  }

  const authorize = async (
    input: Readonly<{
      actor: AuthContext
      connectionId: GoogleConnectionId
      phase: 'provider_call' | 'publish' | 'lease_renewal'
      expected?: ImportDiscoveryAuthorization
      properties?: readonly GoogleImportAuthorizationPropertySnapshot[]
      requireAccessToken: boolean
    }>,
  ) => {
    const result = await deps.authorizeGoogleImportCommand(input)
    if (!result.ok) return deny('unauthorized')
    if (input.expected && !sameAuthorization(result.authorization, input.expected)) {
      return deny('unauthorized')
    }
    if (input.requireAccessToken && !result.accessToken) return deny('unauthorized')
    return result
  }

  const providerAuthorization = (authorization: ImportDiscoveryAuthorization) =>
    Object.freeze({
      capability: 'property.import_gbp_v2' as const,
      organizationId: organizationId(authorization.organizationId),
      propertyId: null,
      connectionId: googleConnectionId(authorization.connectionId),
      initiatorUserId: authorization.userId,
      expectedCredentialGeneration: authorization.credentialGeneration,
      approvalBindingId: authorization.approvalBindingId,
      authorizationVector: authorization.authorizationVector,
    })

  const listAccounts = async (
    input: Readonly<{
      connectionId: GoogleConnectionId
      cursorRef?: string
      signal?: AbortSignal
    }>,
    actor: AuthContext,
  ): Promise<ImportAccountPageDto> => {
    const initial = await authorize({
      actor,
      connectionId: input.connectionId,
      phase: 'provider_call',
      requireAccessToken: true,
    })
    const cursor = input.cursorRef
      ? unwrapReference(
          await deps.references.redeemAccountsCursor({
            cursorRef: input.cursorRef,
            authorization: initial.authorization,
          }),
        )
      : null
    let providerPage: Awaited<ReturnType<GoogleAccountManagementPort['listAccounts']>>
    try {
      providerPage = await deps.accounts.listAccounts({
        accessToken: initial.accessToken!,
        authorization: providerAuthorization(initial.authorization),
        ...(cursor ? { pageToken: cursor.pageToken } : {}),
        signal: input.signal,
      })
    } catch (error) {
      return denyProviderFailure('provider_accounts', error)
    }
    const current = await authorize({
      actor,
      connectionId: input.connectionId,
      phase: 'publish',
      expected: initial.authorization,
      requireAccessToken: false,
    })
    const published = unwrapReference(
      await deps.references.publishAccountPage({
        authorization: current.authorization,
        accounts: providerPage.items.map((account) => ({
          accountId: account.accountId,
          displayName: account.displayName,
          role: account.role,
        })),
        nextPageToken: providerPage.nextPageToken,
        contentDeadlineMs: nowMs() + GOOGLE_IMPORT_DISCOVERY_CONTENT_TTL_MS,
      }),
    )
    return published.value
  }

  const listCandidates = async (
    input:
      | Readonly<{
          connectionId: GoogleConnectionId
          accountRef: string
          cursorRef?: never
          signal?: AbortSignal
        }>
      | Readonly<{
          connectionId: GoogleConnectionId
          cursorRef: string
          accountRef?: never
          signal?: AbortSignal
        }>,
    actor: AuthContext,
  ): Promise<ImportCandidatePageDto> => {
    const initial = await authorize({
      actor,
      connectionId: input.connectionId,
      phase: 'provider_call',
      requireAccessToken: true,
    })
    let account: Readonly<{
      accountRef: string
      accountId: string
      displayName: string
      pageToken?: string
    }>
    if (input.cursorRef !== undefined) {
      const cursor = unwrapReference(
        await deps.references.redeemLocationsCursor({
          cursorRef: input.cursorRef,
          authorization: initial.authorization,
        }),
      )
      account = {
        accountRef: cursor.accountRef,
        accountId: cursor.accountId,
        displayName: cursor.accountDisplayName,
        pageToken: cursor.pageToken,
      }
    } else {
      const selected = unwrapReference(
        await deps.references.resolveAccount({
          accountRef: input.accountRef,
          authorization: initial.authorization,
        }),
      )
      account = {
        accountRef: input.accountRef,
        accountId: selected.accountId,
        displayName: selected.displayName,
      }
    }
    const accountDisplayName = account.displayName
    let providerPage: Awaited<ReturnType<GoogleBusinessInformationPort['listLocations']>>
    try {
      providerPage = await deps.locations.listLocations({
        accessToken: initial.accessToken!,
        authorization: providerAuthorization(initial.authorization),
        accountId: account.accountId,
        accountDisplayName,
        ...(account.pageToken ? { pageToken: account.pageToken } : {}),
        signal: input.signal,
      })
    } catch (error) {
      return denyProviderFailure('provider_locations', error)
    }
    let candidates: readonly ImportDiscoveryCandidate[]
    try {
      candidates = await deps.classifyCandidates({
        actor,
        connectionId: input.connectionId,
        candidates: providerPage.items,
      })
    } catch (error) {
      deps.logger?.warn(
        {
          stage: 'classify',
          candidateCount: providerPage.items.length,
          reason: error instanceof Error ? error.name : 'unknown',
        },
        'Google import discovery denied',
      )
      return deny('temporarily_unavailable')
    }
    if (!classificationsMatch(providerPage.items, candidates)) {
      deps.logger?.warn(
        {
          stage: 'classification_mismatch',
          candidateCount: providerPage.items.length,
          classifiedCount: candidates.length,
        },
        'Google import discovery denied',
      )
      return deny('temporarily_unavailable')
    }
    const current = await authorize({
      actor,
      connectionId: input.connectionId,
      phase: 'publish',
      expected: initial.authorization,
      properties: propertySnapshots(candidates),
      requireAccessToken: false,
    })
    const published = unwrapReference(
      await deps.references.publishCandidatePage({
        authorization: current.authorization,
        account: {
          accountRef: account.accountRef,
          accountId: account.accountId,
          displayName: accountDisplayName,
        },
        candidates,
        nextPageToken: providerPage.nextPageToken,
        contentDeadlineMs: nowMs() + GOOGLE_IMPORT_DISCOVERY_CONTENT_TTL_MS,
      }),
    )
    return published.value
  }

  const renewAuthorizationLease = async (
    input: Readonly<{
      connectionId: GoogleConnectionId
      leaseRef: string
    }>,
    actor: AuthContext,
  ): Promise<ProviderContentLeaseDto> => {
    const initial = await authorize({
      actor,
      connectionId: input.connectionId,
      phase: 'lease_renewal',
      requireAccessToken: false,
    })
    const current = await authorize({
      actor,
      connectionId: input.connectionId,
      phase: 'lease_renewal',
      expected: initial.authorization,
      requireAccessToken: false,
    })
    const renewed = unwrapReference(
      await deps.references.renewLease({
        leaseRef: input.leaseRef,
        authorization: current.authorization,
      }),
    )
    return renewed.lease
  }

  return Object.freeze({ listAccounts, listCandidates, renewAuthorizationLease })
}

export type GoogleImportDiscovery = ReturnType<typeof createGoogleImportDiscovery>
