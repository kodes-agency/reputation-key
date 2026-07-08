// Portal context — finalize upload use case

import type { PortalRepository } from '../ports/portal.repository'
import type { StoragePort } from '../ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalId, unbrand } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'
import type { Queue } from 'bullmq'
import { PROCESS_IMAGE_JOB_NAME as JOB_NAME } from '../job-names'

// fallow-ignore-next-line unused-type
export type FinalizeUploadInput = Readonly<{
  portalId: string
  key: string
}>

// fallow-ignore-next-line unused-type
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
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError(
        'forbidden',
        'Insufficient permissions to finalize portal uploads',
      )
    }

    const portal = await deps.portalRepo.findById(
      ctx.organizationId,
      portalId(input.portalId),
    )
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(
      deps.staffPublicApi,
      ctx,
      'portal.update',
      portal.propertyId,
    )

    const publicUrl = await deps.storage.confirmUpload(input.key)

    const updatedAt = deps.clock()
    await deps.portalRepo.update(ctx.organizationId, portal.id, {
      heroImageUrl: publicUrl,
      updatedAt,
    })

    // Enqueue the image processing job so the resize/WebP pipeline runs
    // (PORTAL-B-04). The job updates heroImageUrl with the optimized variant.
    if (deps.queue) {
      await deps.queue.add(JOB_NAME, {
        key: input.key,
        portalId: input.portalId,
        organizationId: unbrand(ctx.organizationId),
      })
    }

    return { heroImageUrl: publicUrl }
  }

// fallow-ignore-next-line unused-type
export type FinalizeUpload = ReturnType<typeof finalizeUpload>
