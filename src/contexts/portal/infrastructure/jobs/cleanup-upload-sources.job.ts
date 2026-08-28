import type { Job } from 'bullmq'
import type { PortalUploadIssuanceStore } from '../../application/ports/portal-upload-issuance-store.port'
import type { IssuedPortalUploadStoragePort } from '../../application/ports/storage.port'
import type { LoggerPort } from '#/shared/domain/logger.port'

export const JOB_NAME = 'portal-upload-source-cleanup' as const
export const PORTAL_UPLOAD_SOURCE_CLEANUP_LIMIT = 100

export const createCleanupPortalUploadSourcesHandler =
  (
    deps: Readonly<{
      uploadStore: Pick<
        PortalUploadIssuanceStore,
        | 'listSourceCleanupCandidates'
        | 'markSourceDeleted'
        | 'markOrphanDerivativesDeleted'
      >
      storage: Pick<
        IssuedPortalUploadStoragePort,
        'deleteIssuedPortalUpload' | 'deletePortalUploadDerivative'
      >
      clock: () => Date
      logger: Pick<LoggerPort, 'info'>
    }>,
  ) =>
  async (_job: Job): Promise<void> => {
    const observedAt = deps.clock()
    const candidates = await deps.uploadStore.listSourceCleanupCandidates(
      observedAt,
      PORTAL_UPLOAD_SOURCE_CLEANUP_LIMIT,
    )
    let deleted = 0
    let stale = 0
    let failed = 0
    for (const issuance of candidates) {
      try {
        // S3 DeleteObject is idempotent. A crash after deletion and before the
        // durable marker safely repeats this exact issuance-derived delete.
        const scope = {
          organizationId: issuance.organizationId,
          propertyId: issuance.propertyId,
          portalId: issuance.portalId,
          issuanceId: issuance.id,
        }
        let rowChanged = false
        if (issuance.sourceDeletedAt === null) {
          await deps.storage.deleteIssuedPortalUpload(issuance)
          rowChanged =
            (await deps.uploadStore.markSourceDeleted(
              scope,
              issuance.state,
              observedAt,
            )) || rowChanged
        }
        if (
          issuance.state !== 'finalized' &&
          issuance.orphanDerivativesDeletedAt === null
        ) {
          await deps.storage.deletePortalUploadDerivative(issuance, 'hero')
          await deps.storage.deletePortalUploadDerivative(issuance, 'thumbnail')
          rowChanged =
            (await deps.uploadStore.markOrphanDerivativesDeleted(
              scope,
              issuance.state,
              observedAt,
            )) || rowChanged
        }
        if (rowChanged) deleted += 1
        else stale += 1
      } catch {
        failed += 1
      }
    }
    deps.logger.info(
      { job: JOB_NAME, scanned: candidates.length, deleted, stale, failed },
      'Portal private upload source cleanup completed',
    )
    if (failed > 0) {
      throw new Error('Portal private upload source cleanup requires retry')
    }
  }
