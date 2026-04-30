// Portal context — finalize upload use case

import type { PortalRepository } from '../ports/portal.repository'
import type { StoragePort } from '../ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalError } from '../../domain/errors'

// fallow-ignore-next-line unused-type
export type FinalizeUploadDeps = Readonly<{
  portalRepo: PortalRepository
  storage: StoragePort
  clock: () => Date
}>

export const finalizeUpload =
  (deps: FinalizeUploadDeps) =>
  async (
    input: { portalId: string; key: string },
    ctx: AuthContext,
  ): Promise<{ heroImageUrl: string }> => {
    const portal = await deps.portalRepo.findById(
      ctx.organizationId,
      input.portalId as unknown as import('#/shared/domain/ids').PortalId,
    )
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }

    const publicUrl = await deps.storage.confirmUpload(input.key)

    const updatedAt = deps.clock()
    await deps.portalRepo.update(ctx.organizationId, portal.id, {
      heroImageUrl: publicUrl,
      updatedAt,
    })

    return { heroImageUrl: publicUrl }
  }

// fallow-ignore-next-line unused-type
export type FinalizeUpload = ReturnType<typeof finalizeUpload>
