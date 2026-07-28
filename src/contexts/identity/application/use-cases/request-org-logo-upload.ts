// Identity context — request organization logo upload URL use case

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { assertUploadAllowed, MAX_UPLOAD_BYTES } from '../upload-policy'

export type RequestOrgLogoUploadInput = Readonly<{
  contentType: string
  fileSize: number
}>

export type RequestOrgLogoUploadDeps = Readonly<{
  storage: StoragePort
  idGen: () => string
}>

export const requestOrgLogoUpload =
  (deps: RequestOrgLogoUploadDeps) =>
  async (
    input: RequestOrgLogoUploadInput,
    ctx: AuthContext,
  ): Promise<{ uploadUrl: string; key: string }> => {
    assertUploadAllowed(
      ctx,
      'identity.logo_upload',
      input,
      'Insufficient permissions to upload organization logo',
    )

    const key = `organizations/${ctx.organizationId}/logo/${deps.idGen()}`
    const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
      key,
      input.contentType,
      MAX_UPLOAD_BYTES,
    )

    return { uploadUrl, key }
  }

export type RequestOrgLogoUpload = ReturnType<typeof requestOrgLogoUpload>
