// Identity context — image upload policy (single source, BQC-5.9 E19).
//
// The avatar and org-logo upload use cases share the same acceptance rules:
// an allowlist of image content types and a 5 MB size cap. The portal hero
// upload policy (10 MB) is a separate, portal-owned rule.
//
// The cap is checked twice. `assertUploadAllowed` judges the size the browser
// declares when it asks for an upload address; that address carries no length
// bound, so the bytes that arrive can be any size. `assertStoredUploadAllowed`
// judges the size the store reports when the upload is saved, and removes an
// object over the cap. An upload that is never saved is not checked at all:
// see docs/operations/backup-and-lifecycle.md ("What stays in the bucket").

import type { StoragePort } from '#/contexts/portal/application/public-api'
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

/**
 * Read the size of the stored object and refuse one that is over the cap, or
 * whose size the store does not report. A refused object is removed first:
 * nothing will ever point at it. Rejects with the store's own error when the
 * upload never arrived, or when the refused object could not be removed.
 */
export async function assertStoredUploadAllowed(
  storage: Pick<StoragePort, 'inspectObject' | 'deleteObject'>,
  key: string,
): Promise<void> {
  const stored = await storage.inspectObject?.(key)
  const sizeBytes = stored?.sizeBytes ?? null
  if (sizeBytes !== null && sizeBytes <= MAX_UPLOAD_BYTES) return

  await storage.deleteObject(key)
  throw identityError(
    'validation_error',
    sizeBytes === null
      ? 'The uploaded file could not be checked. Upload it again.'
      : 'File size exceeds 5 MB limit',
  )
}
