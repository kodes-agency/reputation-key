// Portal context — request upload URL use case

import type { PortalRepository } from '../ports/portal.repository'
import type { IssuedPortalUploadStoragePort } from '../ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import { portalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { PortalUploadIssuanceStore } from '../ports/portal-upload-issuance-store.port'
import {
  createPortalHeroUploadIssuance,
  PORTAL_HERO_UPLOAD_MAX_BYTES,
} from '../../domain/upload-issuance'

export type RequestUploadUrlInput = Readonly<{
  portalId: string
  contentType: string
  fileSize: number
}>

export type RequestUploadUrlDeps = Readonly<{
  portalRepo: PortalRepository
  uploadStore: PortalUploadIssuanceStore
  storage: Pick<IssuedPortalUploadStoragePort, 'createIssuedPortalUpload'>
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

export type IssuedPortalUploadView = Readonly<{
  uploadUrl: string
  uploadId: string
  expiresAt: string
  contentType: string
  maxSizeBytes: number
}>

export const requestUploadUrl =
  (deps: RequestUploadUrlDeps) =>
  async (
    input: RequestUploadUrlInput,
    ctx: AuthContext,
  ): Promise<IssuedPortalUploadView> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to upload portal images',
    })

    const now = deps.clock()
    const issuance = createPortalHeroUploadIssuance({
      id: deps.idGen(),
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      contentType: input.contentType,
      declaredSizeBytes: input.fileSize,
      now,
    })
    if (!issuance) {
      throw portalError(
        'upload_failed',
        `Upload must be a JPEG, PNG, or WebP image no larger than ${PORTAL_HERO_UPLOAD_MAX_BYTES} bytes`,
      )
    }

    try {
      await deps.uploadStore.create(issuance)
    } catch {
      // Creation may have failed because this opaque ID already belongs to an
      // existing issuance. Never transition a row we did not create.
      throw portalError('upload_failed', 'Unable to issue a secure upload')
    }

    try {
      const { uploadUrl } = await deps.storage.createIssuedPortalUpload(issuance)
      return {
        uploadUrl,
        uploadId: issuance.id,
        expiresAt: issuance.expiresAt.toISOString(),
        contentType: issuance.contentType,
        maxSizeBytes: issuance.maxSizeBytes,
      }
    } catch {
      try {
        await deps.uploadStore.rejectIssued(
          {
            organizationId: issuance.organizationId,
            propertyId: issuance.propertyId,
            portalId: issuance.portalId,
            issuanceId: issuance.id,
          },
          'rejected',
          deps.clock(),
        )
      } catch {
        // The issuance expires closed; a later orphan sweep can repair a
        // failed best-effort terminal transition without exposing the key.
      }
      throw portalError('upload_failed', 'Unable to issue a secure upload')
    }
  }

export type RequestUploadUrl = ReturnType<typeof requestUploadUrl>
