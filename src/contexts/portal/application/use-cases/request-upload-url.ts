// Portal context — request upload URL use case

import type { PortalRepository } from '../ports/portal.repository'
import type { StoragePort } from '../ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { assertPropertyAccess } from '../assert-property-access'

// fallow-ignore-next-line unused-type
export type RequestUploadUrlInput = Readonly<{
  portalId: string
  contentType: string
  fileSize: number
}>

// fallow-ignore-next-line unused-type
export type RequestUploadUrlDeps = Readonly<{
  portalRepo: PortalRepository
  storage: StoragePort
  staffPublicApi: StaffPublicApi
  idGen: () => string
}>

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export const requestUploadUrl =
  (deps: RequestUploadUrlDeps) =>
  async (
    input: RequestUploadUrlInput,
    ctx: AuthContext,
  ): Promise<{ uploadUrl: string; key: string }> => {
    if (!canForContext(ctx, 'portal.update')) {
      throw portalError('forbidden', 'Insufficient permissions to upload portal images')
    }
    const portal = await deps.portalRepo.findById(
      ctx.organizationId,
      portalId(input.portalId),
    )
    if (!portal) {
      throw portalError('portal_not_found', 'portal not found in this organization')
    }
    // Enforce property-assignment scoping (D6-001.)
    await assertPropertyAccess(deps.staffPublicApi, ctx, portal.propertyId)

    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
      throw portalError(
        'upload_failed',
        `content type ${input.contentType} is not allowed`,
      )
    }

    if (input.fileSize > MAX_FILE_SIZE) {
      throw portalError('upload_failed', 'file size exceeds 10 MB limit')
    }

    const key = `portals/${portal.organizationId}/${portal.id}/hero/${deps.idGen()}`
    const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
      key,
      input.contentType,
      MAX_FILE_SIZE,
    )

    return { uploadUrl, key }
  }

// fallow-ignore-next-line unused-type
export type RequestUploadUrl = ReturnType<typeof requestUploadUrl>
