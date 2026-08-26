// Portal context — finalize upload use case

import type { PortalRepository } from '../ports/portal.repository'
import type { IssuedPortalUploadStoragePort } from '../ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { PortalUploadIssuanceStore } from '../ports/portal-upload-issuance-store.port'
import { portalError } from '../../domain/errors'
import { portalHeroImageProcessingRequested } from '../../domain/events'
import {
  isSafePortalObjectETag,
  portalUploadMetadataMatches,
} from '../../domain/upload-issuance'

export type FinalizeUploadInput = Readonly<{
  portalId: string
  uploadId: string
}>

export type FinalizeUploadDeps = Readonly<{
  portalRepo: PortalRepository
  uploadStore: PortalUploadIssuanceStore
  storage: Pick<
    IssuedPortalUploadStoragePort,
    'confirmIssuedPortalUpload' | 'deleteIssuedPortalUpload'
  >
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export const finalizeUpload =
  (deps: FinalizeUploadDeps) =>
  async (
    input: FinalizeUploadInput,
    ctx: AuthContext,
  ): Promise<{ heroImageUrl: string | null; processing: boolean }> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to finalize portal uploads',
    })

    const scope = {
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      issuanceId: input.uploadId,
    }
    const issuance = await deps.uploadStore.findScoped(scope)
    if (!issuance || issuance.state !== 'issued') {
      throw portalError('upload_failed', 'Upload authorization is unavailable')
    }

    const checkedAt = deps.clock()
    if (checkedAt >= issuance.expiresAt) {
      await deps.uploadStore.rejectIssued(scope, 'expired', checkedAt)
      try {
        await deps.storage.deleteIssuedPortalUpload(issuance)
      } catch {
        // Expired authorization stays terminal even if orphan cleanup retries later.
      }
      throw portalError('upload_failed', 'Upload authorization has expired')
    }

    let observed: Awaited<
      ReturnType<IssuedPortalUploadStoragePort['confirmIssuedPortalUpload']>
    >
    try {
      observed = await deps.storage.confirmIssuedPortalUpload(issuance)
    } catch {
      await deps.uploadStore.rejectIssued(scope, 'rejected', deps.clock())
      try {
        await deps.storage.deleteIssuedPortalUpload(issuance)
      } catch {
        // The rejected row remains durable for an orphan-cleanup retry.
      }
      throw portalError('upload_failed', 'Uploaded object could not be verified')
    }

    if (
      !portalUploadMetadataMatches(issuance, observed) ||
      !isSafePortalObjectETag(observed.sourceETag)
    ) {
      await deps.uploadStore.rejectIssued(scope, 'rejected', deps.clock())
      try {
        await deps.storage.deleteIssuedPortalUpload(issuance)
      } catch {
        // The rejected row remains durable for an orphan-cleanup retry.
      }
      throw portalError(
        'upload_failed',
        'Uploaded object did not match its authorization',
      )
    }

    // Storage verification can cross the authorization deadline. The locked
    // transition must use a fresh time rather than the pre-flight timestamp.
    const stagedAt = deps.clock()
    const processingRequested = portalHeroImageProcessingRequested({
      uploadId: issuance.id,
      organizationId: issuance.organizationId,
      propertyId: issuance.propertyId,
      portalId: issuance.portalId,
      sourceETag: observed.sourceETag,
      occurredAt: stagedAt,
    })
    const staged = await deps.uploadStore.stage(
      scope,
      observed,
      processingRequested,
      stagedAt,
    )
    if (staged.outcome !== 'staged') {
      if (staged.outcome === 'metadata_mismatch' || staged.outcome === 'expired') {
        try {
          await deps.storage.deleteIssuedPortalUpload(issuance)
        } catch {
          // The terminal row remains durable for an orphan-cleanup retry.
        }
      }
      throw portalError(
        'upload_failed',
        staged.outcome === 'metadata_mismatch'
          ? 'Uploaded object did not match its authorization'
          : 'Upload authorization is unavailable',
      )
    }

    // The issuance transition and processing request share one transaction.
    // Queue/relay outage leaves a replayable outbox fact instead of a stranded
    // consumed upload.
    return { heroImageUrl: staged.heroImageUrl, processing: true }
  }

export type FinalizeUpload = ReturnType<typeof finalizeUpload>
