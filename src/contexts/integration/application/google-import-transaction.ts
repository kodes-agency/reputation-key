import { randomUUID } from 'node:crypto'
import type { AuthContext } from '#/shared/domain/auth-context'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import {
  isRegionProcessable,
  ROUTING_POLICY_VERSION,
} from '#/contexts/property/application/public-api'
import { resolveRegion } from '#/shared/domain/processing-profile'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import type {
  RetryPropertyImportItemInput,
  StartPropertyImportV2Input,
} from './dto/google-import-v2.dto'
import type {
  ClaimedImportCandidate,
  GoogleImportReferenceStore,
} from './ports/google-import-reference-store.port'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import type {
  GoogleImportV2RetryCandidate,
  GoogleImportV2Store,
} from './ports/google-import-v2-store.port'
import {
  createGoogleImportReplayDigests,
  type GoogleImportSemanticItem,
} from './google-import-replay'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

const EFFECT_DEADLINE_MS = 24 * 60 * 60 * 1_000
type ImportInputItem = StartPropertyImportV2Input['items'][number]
type OrderedImportCandidate = Readonly<{
  input: ImportInputItem
  claim: ClaimedImportCandidate
}>

export type GoogleImportTransactionErrorCode =
  'unauthorized' | 'invalid_reference' | 'request_conflict' | 'temporarily_unavailable'

export class GoogleImportTransactionError extends Error {
  readonly code: GoogleImportTransactionErrorCode

  constructor(code: GoogleImportTransactionErrorCode) {
    super(`Google import transaction failed: ${code}`)
    this.name = 'GoogleImportTransactionError'
    this.code = code
  }
}

function fail(code: GoogleImportTransactionErrorCode): never {
  throw new GoogleImportTransactionError(code)
}

function semanticProfile(
  input: StartPropertyImportV2Input['items'][number],
  claim: ClaimedImportCandidate,
) {
  if (input.action === 'create') {
    return {
      name: input.profile.name,
      address: input.profile.address,
      countryCode: input.profile.countryCode,
      timezone: input.profile.timezone,
      updateExistingProfile: true,
    }
  }
  if (input.profile.updateExistingProfile) {
    return {
      name: input.profile.name,
      address: input.profile.address,
      countryCode:
        claim.candidate.eligibility.kind === 'relink'
          ? claim.candidate.eligibility.profile.countryCode
          : null,
      timezone: input.profile.timezone,
      updateExistingProfile: true,
    }
  }
  if (claim.candidate.eligibility.kind !== 'relink') fail('invalid_reference')
  return {
    name: claim.candidate.eligibility.profile.name,
    address: claim.candidate.eligibility.profile.address,
    countryCode: claim.candidate.eligibility.profile.countryCode,
    timezone: input.profile.timezone,
    updateExistingProfile: false,
  }
}

function semanticItem(
  input: StartPropertyImportV2Input['items'][number],
  claim: ClaimedImportCandidate,
): GoogleImportSemanticItem {
  return {
    action: input.action,
    connectionId: claim.authorization.connectionId,
    accountId: claim.candidate.accountId,
    locationId: claim.candidate.locationId,
    existingPropertyId: input.action === 'relink' ? input.existingPropertyId : null,
    expectedConnectionLifecycleVersion: claim.authorization.connectionLifecycleVersion,
    expectedConnectionAccessVersion: claim.authorization.connectionAccessVersion,
    expectedCredentialGeneration: claim.authorization.credentialGeneration,
    expectedSourceEpoch: claim.candidate.expectedSourceEpoch ?? null,
    expectedProfileVersion: claim.candidate.expectedProfileVersion ?? null,
    profile: semanticProfile(input, claim),
  }
}

export function createGoogleImportTransaction(
  deps: Readonly<{
    store: GoogleImportV2Store
    references: GoogleImportReferenceStore
    propertyBindingApi: PropertyGoogleBindingPublicApi
    authorizeGoogleImportCommand: GoogleImportCommandAuthorizer
    replayKeys: VersionedHmacKeyring
    clock: () => Date
    idGen?: () => string
  }>,
) {
  const replay = createGoogleImportReplayDigests(deps.replayKeys)
  const idGen = deps.idGen ?? randomUUID
  const replayScope = (actor: AuthContext, requestId: string) => ({
    organizationId: String(actor.organizationId),
    userId: String(actor.userId),
    requestId,
  })

  const authorizeEntries = async (
    ordered: readonly OrderedImportCandidate[],
    actor: AuthContext,
  ): Promise<void> => {
    for (const entry of ordered) {
      const properties =
        entry.input.action === 'relink'
          ? (() => {
              const sourceEpoch = entry.claim.candidate.expectedSourceEpoch
              const profileVersion = entry.claim.candidate.expectedProfileVersion
              if (
                sourceEpoch === null ||
                sourceEpoch === undefined ||
                profileVersion === null ||
                profileVersion === undefined
              ) {
                return fail('invalid_reference')
              }
              return [
                {
                  propertyId: propertyId(entry.input.existingPropertyId),
                  sourceEpoch,
                  profileVersion,
                  action: 'property.update' as const,
                },
              ]
            })()
          : []
      const authorization = await deps.authorizeGoogleImportCommand({
        actor,
        connectionId: googleConnectionId(entry.claim.authorization.connectionId),
        phase: 'publish',
        expected: entry.claim.authorization,
        properties,
        requireAccessToken: false,
      })
      if (!authorization.ok) fail('unauthorized')
    }
  }

  const authorizeRetryCandidate = async (
    candidate: GoogleImportV2RetryCandidate,
    actor: AuthContext,
  ): Promise<'authorized' | 'denied' | 'unavailable'> => {
    const properties =
      candidate.existingPropertyId === null
        ? []
        : candidate.expectedSourceEpoch === null ||
            candidate.expectedProfileVersion === null
          ? null
          : [
              {
                propertyId: propertyId(candidate.existingPropertyId),
                sourceEpoch: candidate.expectedSourceEpoch,
                profileVersion: candidate.expectedProfileVersion,
                action: 'property.update' as const,
              },
            ]
    if (properties === null) return 'denied'
    const authorization = await deps.authorizeGoogleImportCommand({
      actor,
      connectionId: googleConnectionId(candidate.connectionId),
      phase: 'publish',
      expected: candidate.authorization,
      properties,
      requireAccessToken: false,
    })
    if (authorization.ok) return 'authorized'
    return authorization.code === 'runtime_unavailable' ? 'unavailable' : 'denied'
  }

  const start = async (
    input: StartPropertyImportV2Input,
    actor: AuthContext,
  ): Promise<Readonly<{ importJobId: string; replayed: boolean }>> => {
    const scope = replayScope(actor, input.requestId)
    let existing
    try {
      existing = await deps.store.findReplay(scope.organizationId, input.requestId)
    } catch {
      return fail('temporarily_unavailable')
    }
    if (existing) {
      if (existing.initiatedBy !== scope.userId) {
        return fail('request_conflict')
      }
      if (existing.wireReplay && replay.verifyWire(scope, input, existing.wireReplay)) {
        return { importJobId: existing.importJobId, replayed: true }
      }
      if (!existing.semanticReplay) return fail('request_conflict')
    }

    const candidateRefs = input.items.map((item) => item.candidateRef)
    let claimed
    try {
      claimed = await deps.references.claimCandidates({
        candidateRefs,
        organizationId: scope.organizationId,
        userId: scope.userId,
        requestId: input.requestId,
      })
    } catch {
      return fail('temporarily_unavailable')
    }
    if (!claimed.ok) {
      return fail(
        claimed.code === 'runtime_unavailable'
          ? 'temporarily_unavailable'
          : 'invalid_reference',
      )
    }

    let releaseClaims = true
    const claimIdentity = {
      candidateRefs,
      organizationId: scope.organizationId,
      userId: scope.userId,
      requestId: input.requestId,
    }
    const consumeClaims = async (): Promise<void> => {
      releaseClaims = false
      await deps.references.consumeCandidateClaims(claimIdentity)
    }
    try {
      if (claimed.candidates.length !== input.items.length) {
        return fail('invalid_reference')
      }
      const byReference = new Map<string, ClaimedImportCandidate>()
      for (const candidate of claimed.candidates) {
        if (
          byReference.has(candidate.candidateRef) ||
          candidate.authorization.organizationId !== scope.organizationId ||
          candidate.authorization.userId !== scope.userId
        ) {
          return fail('invalid_reference')
        }
        byReference.set(candidate.candidateRef, candidate)
      }
      const ordered: readonly OrderedImportCandidate[] = input.items.map((item) => {
        const candidate = byReference.get(item.candidateRef)
        if (!candidate) return fail('invalid_reference')
        if (candidate.candidate.eligibility.kind !== item.action) {
          return fail('invalid_reference')
        }
        if (
          item.action === 'relink' &&
          candidate.candidate.eligibility.kind === 'relink' &&
          candidate.candidate.eligibility.propertyId !== item.existingPropertyId
        ) {
          return fail('invalid_reference')
        }
        return { input: item, claim: candidate }
      })

      await authorizeEntries(ordered, actor)
      const semanticItems = ordered.map((entry) => semanticItem(entry.input, entry.claim))
      const semanticRequest = { requestId: input.requestId, items: semanticItems }
      if (existing) {
        if (
          !existing.semanticReplay ||
          !replay.verifySemantic(scope, semanticRequest, existing.semanticReplay)
        ) {
          return fail('request_conflict')
        }
        await consumeClaims()
        return { importJobId: existing.importJobId, replayed: true }
      }

      const now = deps.clock()
      const importJobId = idGen()
      const items = await Promise.all(
        semanticItems.map(async (item, index) => {
          const source = ordered[index]
          if (!source) return fail('invalid_reference')
          const currentAuthorization = source.claim.authorization
          const vector = currentAuthorization.authorizationVector
          if (
            currentAuthorization.organizationId !== scope.organizationId ||
            currentAuthorization.userId !== scope.userId ||
            currentAuthorization.connectionId !== item.connectionId ||
            typeof vector.executionPolicyVersion !== 'string' ||
            !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(vector.executionPolicyVersion) ||
            typeof vector.googleContentPolicyVersion !== 'number' ||
            !Number.isSafeInteger(vector.googleContentPolicyVersion) ||
            typeof vector.emergencyKillVersion !== 'number' ||
            !Number.isSafeInteger(vector.emergencyKillVersion) ||
            typeof vector.role !== 'string' ||
            vector.role.length < 1 ||
            typeof vector.permissionDigest !== 'string' ||
            !/^[a-f0-9]{64}$/.test(vector.permissionDigest)
          ) {
            return fail('invalid_reference')
          }
          const resolvedRegion =
            item.action === 'create'
              ? item.profile.countryCode
                ? resolveRegion(item.profile.countryCode)
                : null
              : ((
                  await deps.propertyBindingApi.readInternal(
                    organizationId(scope.organizationId),
                    propertyId(item.existingPropertyId!),
                  )
                )?.processingRegion ?? null)
          if (resolvedRegion === null || !isRegionProcessable(resolvedRegion)) {
            return fail('invalid_reference')
          }
          return {
            id: idGen(),
            connectionId: item.connectionId,
            existingPropertyId: item.existingPropertyId,
            destinationPropertyId:
              item.action === 'create' ? idGen() : item.existingPropertyId!,
            authorization: currentAuthorization,
            providerAccountSuffix: item.accountId,
            providerLocationSuffix: item.locationId,
            expectedConnectionLifecycleVersion: item.expectedConnectionLifecycleVersion,
            expectedConnectionAccessVersion: item.expectedConnectionAccessVersion,
            expectedCredentialGeneration: item.expectedCredentialGeneration,
            expectedSourceEpoch: item.expectedSourceEpoch,
            expectedProfileVersion: item.expectedProfileVersion,
            action: item.action,
            updateExistingProfile: item.profile.updateExistingProfile,
            propertyName: item.profile.name,
            propertyAddress: item.profile.address,
            countryCode: item.profile.countryCode,
            timezone: item.profile.timezone,
            processingRegion: resolvedRegion,
            routingPolicyVersion: ROUTING_POLICY_VERSION,
            effectDeadlineAt: new Date(now.getTime() + EFFECT_DEADLINE_MS),
          }
        }),
      )

      // Close routing/profile races before publishing a durable dispatch intent.
      await authorizeEntries(ordered, actor)
      const intent = {
        id: importJobId,
        organizationId: scope.organizationId,
        requestId: input.requestId,
        initiatedBy: scope.userId,
        wireReplay: replay.signWire(scope, input),
        semanticReplay: replay.signSemantic(scope, semanticRequest),
        items,
        now,
        outboxEventId: idGen(),
      }
      let committedResult
      try {
        committedResult = await deps.store.commitIntent(intent)
      } catch {
        let recovered
        try {
          recovered = await deps.store.findReplay(scope.organizationId, input.requestId)
        } catch {
          // The commit outcome is ambiguous. Preserve the bounded claims until
          // expiry rather than permitting overlapping work.
          releaseClaims = false
          return fail('temporarily_unavailable')
        }
        if (
          recovered?.initiatedBy === scope.userId &&
          recovered.semanticReplay &&
          replay.verifySemantic(scope, semanticRequest, recovered.semanticReplay)
        ) {
          await consumeClaims()
          return { importJobId: recovered.importJobId, replayed: true }
        }
        return fail(recovered ? 'request_conflict' : 'temporarily_unavailable')
      }
      if (committedResult === 'conflict') {
        let recovered
        try {
          recovered = await deps.store.findReplay(scope.organizationId, input.requestId)
        } catch {
          releaseClaims = false
          return fail('temporarily_unavailable')
        }
        if (
          recovered?.initiatedBy === scope.userId &&
          recovered.semanticReplay &&
          replay.verifySemantic(scope, semanticRequest, recovered.semanticReplay)
        ) {
          await consumeClaims()
          return { importJobId: recovered.importJobId, replayed: true }
        }
        return fail('request_conflict')
      }
      await consumeClaims()
      return { importJobId, replayed: false }
    } finally {
      if (releaseClaims) {
        await deps.references.releaseCandidateClaims(claimIdentity)
      }
    }
  }

  const retry = async (
    input: RetryPropertyImportItemInput,
    actor: AuthContext,
  ): Promise<
    Readonly<{
      importJobId: string
      retryRevision: number
      replayed: boolean
    }>
  > => {
    const scope = replayScope(actor, input.retryRequestId)
    let result
    try {
      result = await deps.store.retryItem({
        organizationId: scope.organizationId,
        initiatingUserId: scope.userId,
        itemId: input.itemId,
        retryRequestId: input.retryRequestId,
        expectedRetryRevision: input.expectedRetryRevision,
        requestDigest: replay.signRetry(scope, input),
        matchesRequestDigest: (stored) => replay.verifyRetry(scope, input, stored),
        now: deps.clock(),
        outboxEventId: idGen(),
        authorize: (candidate) => authorizeRetryCandidate(candidate, actor),
      })
    } catch {
      return fail('temporarily_unavailable')
    }
    if (!('reason' in result)) {
      return {
        importJobId: result.importJobId,
        retryRevision: result.retryRevision,
        replayed: result.kind === 'replayed',
      }
    }
    switch (result.reason) {
      case 'missing':
      case 'not_initiator':
        return fail('invalid_reference')
      case 'authorization_denied':
        return fail('unauthorized')
      case 'authorization_unavailable':
        return fail('temporarily_unavailable')
      case 'request_conflict':
      case 'stale_revision':
      case 'not_retryable':
      case 'effect_expired':
        return fail('request_conflict')
    }
  }

  const recover = async (
    requestId: string,
    actor: AuthContext,
  ): Promise<Readonly<{ importJobId: string }>> => {
    const existing = await deps.store.findReplay(actor.organizationId, requestId)
    if (!existing || existing.initiatedBy !== actor.userId) {
      return fail('invalid_reference')
    }
    return { importJobId: existing.importJobId }
  }

  const status = async (importJobId: string, actor: AuthContext) => {
    try {
      const result = await deps.store.getProgress(
        actor.organizationId,
        actor.userId,
        importJobId,
      )
      if (!result) return fail('invalid_reference')
      const candidates = await deps.store.listRetryCandidates(
        actor.organizationId,
        actor.userId,
        importJobId,
        deps.clock(),
      )
      const authorized = new Set<string>()
      for (const candidate of candidates) {
        try {
          if ((await authorizeRetryCandidate(candidate, actor)) === 'authorized') {
            authorized.add(candidate.itemId)
          }
        } catch {
          // Progress remains available; an unavailable authorization dependency
          // only disables the transient retry control.
        }
      }
      const items = result.items.map((item) => ({
        ...item,
        retryable: item.retryable && authorized.has(item.itemId),
      }))
      return {
        ...result,
        items,
        canRetry: items.some((item) => item.retryable),
      }
    } catch (error) {
      if (error instanceof GoogleImportTransactionError) throw error
      return fail('temporarily_unavailable')
    }
  }

  return Object.freeze({ start, retry, recover, status })
}
