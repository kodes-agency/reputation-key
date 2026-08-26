import type {
  PortalUploadIssuanceStore,
  PortalUploadScope,
  PublishPortalUploadResult,
  StagePortalUploadResult,
} from '#/contexts/portal/application/ports/portal-upload-issuance-store.port'
import {
  portalUploadMetadataMatches,
  type PortalUploadIssuance,
  type PortalUploadObservedMetadata,
} from '#/contexts/portal/domain/upload-issuance'

const sameScope = (issuance: PortalUploadIssuance, scope: PortalUploadScope) =>
  issuance.id === scope.issuanceId &&
  issuance.organizationId === scope.organizationId &&
  issuance.propertyId === scope.propertyId &&
  issuance.portalId === scope.portalId &&
  issuance.purpose === 'hero_image'

export function createInMemoryPortalUploadIssuanceStore(
  initial: ReadonlyArray<PortalUploadIssuance> = [],
): PortalUploadIssuanceStore &
  Readonly<{ all: () => ReadonlyArray<PortalUploadIssuance> }> {
  let rows = initial.map((row) => ({ ...row }))

  const findIndex = (scope: PortalUploadScope) =>
    rows.findIndex((row) => sameScope(row, scope))

  return {
    all: () => rows.map((row) => ({ ...row })),
    create: async (issuance) => {
      if (rows.some((row) => row.id === issuance.id)) {
        throw new Error('duplicate portal upload issuance')
      }
      rows.push({ ...issuance })
    },
    findScoped: async (scope) => {
      const row = rows.find((candidate) => sameScope(candidate, scope))
      return row ? { ...row } : null
    },
    rejectIssued: async (scope, reason, at) => {
      const index = findIndex(scope)
      if (index < 0 || rows[index].state !== 'issued') return false
      rows[index] = {
        ...rows[index],
        state: reason,
        rejectedAt: reason === 'rejected' ? at : rows[index].rejectedAt,
        expiredAt: reason === 'expired' ? at : rows[index].expiredAt,
      }
      return true
    },
    stage: async (
      scope: PortalUploadScope,
      observed: PortalUploadObservedMetadata,
      at: Date,
    ): Promise<StagePortalUploadResult> => {
      const index = findIndex(scope)
      if (index < 0) return { outcome: 'not_found' }
      const row = rows[index]
      if (row.state !== 'issued') return { outcome: 'not_issued' }
      if (at >= row.expiresAt) {
        rows[index] = { ...row, state: 'expired', expiredAt: at }
        return { outcome: 'expired' }
      }
      if (!portalUploadMetadataMatches(row, observed)) {
        rows[index] = { ...row, state: 'rejected', rejectedAt: at }
        return { outcome: 'metadata_mismatch' }
      }

      rows = rows.map((candidate) =>
        candidate.organizationId === row.organizationId &&
        candidate.portalId === row.portalId &&
        candidate.purpose === row.purpose &&
        candidate.state === 'consumed'
          ? { ...candidate, state: 'superseded' as const, supersededAt: at }
          : candidate,
      )
      rows[index] = { ...rows[index], state: 'consumed', consumedAt: at }
      return { outcome: 'staged', heroImageUrl: null }
    },
    findProcessable: async (scope) => {
      const row = rows.find(
        (candidate) => sameScope(candidate, scope) && candidate.state === 'consumed',
      )
      return row ? { ...row } : null
    },
    publishDerivative: async (
      scope,
      derivative,
      at,
    ): Promise<PublishPortalUploadResult> => {
      const index = findIndex(scope)
      if (index < 0) return { outcome: 'not_found' }
      if (rows[index].state === 'finalized') return { outcome: 'already_finalized' }
      if (rows[index].state !== 'consumed') return { outcome: 'stale' }
      rows[index] = {
        ...rows[index],
        state: 'finalized',
        finalizedAt: at,
        heroDerivativeKey: derivative.heroKey,
        thumbnailDerivativeKey: derivative.thumbnailKey,
        heroImageUrl: derivative.heroImageUrl,
      }
      return { outcome: 'published', heroImageUrl: derivative.heroImageUrl }
    },
  }
}
