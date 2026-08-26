// Portal context — finalize upload use case

import type { PortalRepository } from '../ports/portal.repository'
import type { IssuedPortalUploadStoragePort } from '../ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, unbrand } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
// BQC-5.1: application must not import bullmq directly — the Queue type comes
// from the shared/jobs wiring surface (re-exported there).
import type { Queue } from '#/shared/jobs/queue'
import { PROCESS_IMAGE_JOB_NAME as JOB_NAME } from '../job-names'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import type { PortalUploadIssuanceStore } from '../ports/portal-upload-issuance-store.port'
import { portalError } from '../../domain/errors'

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
  queue: Queue | undefined
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

    // Storage verification can cross the authorization deadline. The locked
    // transition must use a fresh time rather than the pre-flight timestamp.
    const staged = await deps.uploadStore.stage(scope, observed, deps.clock())
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

    // Enqueue the image processing job so the resize/WebP pipeline runs
    // (PORTAL-B-04). The job updates heroImageUrl with the optimized variant.
    // BQC-3.6: attempts/backoff+jitter/timeout from the job catalogue.
    if (deps.queue) {
      await deps.queue.add(
        JOB_NAME,
        {
          uploadId: issuance.id,
          portalId: input.portalId,
          ...createJobExecutionEnvelope({
            organizationId: unbrand(ctx.organizationId),
            propertyId: unbrand(portal.propertyId),
            capability: 'portal.upload',
            initiator: { kind: 'user', id: unbrand(ctx.userId) },
            correlationId: `portal-upload:${input.portalId}`,
          }),
        },
        {
          ...jobEnqueueOptions(JOB_NAME),
          jobId: `portal-upload-${issuance.id}`,
        },
      )
    }

    return { heroImageUrl: staged.heroImageUrl, processing: deps.queue !== undefined }
  }

export type FinalizeUpload = ReturnType<typeof finalizeUpload>
