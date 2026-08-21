// The guest optional-image protocol, client side: what may be selected, and the
// three-step issue → PUT → confirm upload it goes through.
//
// The allowed types and the 10 MiB cap mirror the server's `issueMediaSchema`
// (contexts/guest/server/public.ts). The server remains the authority; these exist
// so an unacceptable file is refused at selection, before any network call.
// Validating after `submitResponse` had already persisted the response flipped the
// form into correcting mode and silently consumed the guest's single one-hour
// correction.

// Not exported: the values are the module's own selection rule. `selectGuestMedia`
// is the boundary, and `AllowedMediaType` carries the narrowing outward, so no
// caller needs the raw list or the byte cap.
const allowedMediaTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedMediaType = (typeof allowedMediaTypes)[number]
const maxMediaBytes = 10 * 1024 * 1024
export const mediaRejectionMessage = 'Choose a JPEG, PNG, or WebP image up to 10 MiB.'

/**
 * Carries the content type narrowed at selection time, so the upload path needs
 * neither a re-check nor a cast to satisfy `issueMedia`'s contentType union.
 */
export type SelectedMedia = Readonly<{ file: File; contentType: AllowedMediaType }>

/** `null` when the file can never be uploaded — wrong type, or over the size cap. */
export function selectGuestMedia(file: File): SelectedMedia | null {
  const contentType = allowedMediaTypes.find((allowed) => allowed === file.type)
  if (contentType === undefined || file.size > maxMediaBytes) return null
  return { file, contentType }
}

export type IssueGuestMediaAction = (input: {
  data: {
    token: string
    csrfNonce: string
    contentType: AllowedMediaType
    sizeBytes: number
  }
}) => Promise<{
  mediaId: string
  objectKey: string
  uploadUrl: string
  contentType: string
}>

export type ConfirmGuestMediaAction = (input: {
  data: { token: string; csrfNonce: string; mediaId: string; objectKey: string }
}) => Promise<{ mediaId: string; status: 'ready' }>

/** Throws on a failed upload so the caller surfaces one message for the whole submit. */
export async function uploadGuestMedia(
  input: Readonly<{
    media: SelectedMedia
    token: string
    csrfNonce: string
    issueMedia: IssueGuestMediaAction
    confirmMedia: ConfirmGuestMediaAction
  }>,
): Promise<void> {
  const { media, token, csrfNonce } = input
  const issuance = await input.issueMedia({
    data: {
      token,
      csrfNonce,
      contentType: media.contentType,
      sizeBytes: media.file.size,
    },
  })
  const upload = await fetch(issuance.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': issuance.contentType },
    body: media.file,
  })
  if (!upload.ok) throw new Error('The image upload did not complete.')
  await input.confirmMedia({
    data: { token, csrfNonce, mediaId: issuance.mediaId, objectKey: issuance.objectKey },
  })
}
