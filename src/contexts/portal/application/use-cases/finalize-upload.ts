// Portal context — finalize upload use case

import type { PortalRepository } from '../ports/portal.repository'
import type { StoragePort } from '../ports/storage.port'
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

export type FinalizeUploadInput = Readonly<{
  portalId: string
  key: string
}>

export type FinalizeUploadDeps = Readonly<{
  portalRepo: PortalRepository
  storage: StoragePort
  staffPublicApi: StaffPublicApi
  clock: () => Date
  queue: Queue | undefined
}>

export const finalizeUpload =
  (deps: FinalizeUploadDeps) =>
  async (
    input: FinalizeUploadInput,
    ctx: AuthContext,
  ): Promise<{ heroImageUrl: string }> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to finalize portal uploads',
    })

    const publicUrl = await deps.storage.confirmUpload(input.key)

    const updatedAt = deps.clock()
    await deps.portalRepo.update(ctx.organizationId, portal.id, {
      heroImageUrl: publicUrl,
      updatedAt,
    })

    // Enqueue the image processing job so the resize/WebP pipeline runs
    // (PORTAL-B-04). The job updates heroImageUrl with the optimized variant.
    // BQC-3.6: attempts/backoff+jitter/timeout from the job catalogue.
    if (deps.queue) {
      await deps.queue.add(
        JOB_NAME,
        {
          key: input.key,
          portalId: input.portalId,
          ...createJobExecutionEnvelope({
            organizationId: unbrand(ctx.organizationId),
            propertyId: unbrand(portal.propertyId),
            capability: 'portal.upload',
            initiator: { kind: 'user', id: unbrand(ctx.userId) },
            correlationId: `portal-upload:${input.portalId}`,
          }),
        },
        jobEnqueueOptions(JOB_NAME),
      )
    }

    return { heroImageUrl: publicUrl }
  }

export type FinalizeUpload = ReturnType<typeof finalizeUpload>
