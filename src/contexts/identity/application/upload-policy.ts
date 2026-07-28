// Identity context — image upload policy (single source, BQC-5.9 E19).
//
// The avatar and org-logo upload use cases share the same acceptance rules:
// an allowlist of image content types and a 5 MB size cap. The portal hero
// upload policy (10 MB) is a separate, portal-owned rule.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../domain/errors'

export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * Authorize the upload `permission` and validate the declared content type
 * and file size against the upload policy. `forbiddenMessage` is the
 * use-case-specific authorization failure message.
 */
export function assertUploadAllowed(
  ctx: AuthContext,
  permission: Permission,
  input: Readonly<{ contentType: string; fileSize: number }>,
  forbiddenMessage: string,
): void {
  if (!canForContext(ctx, permission)) {
    throw identityError('forbidden', forbiddenMessage)
  }

  if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(input.contentType)) {
    throw identityError(
      'validation_error',
      `Content type ${input.contentType} is not allowed`,
    )
  }

  if (input.fileSize > MAX_UPLOAD_BYTES) {
    throw identityError('validation_error', 'File size exceeds 5 MB limit')
  }
}
