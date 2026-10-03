// The browser's half of an image upload: the checks that save a round trip, the
// request, and the sentence a person reads when the server says no.
//
// The upload is the raw bytes of one image posted to the same-origin media
// endpoint (`PORTAL_MEDIA_UPLOAD_PATH`), not a form and not a server function, so
// it is a plain `fetch`; the server decodes and re-encodes whatever arrives and
// is the only authority on what is acceptable. The checks here mirror it so a
// 20 MB GIF is not sent at all.

import {
  PORTAL_MEDIA_MAX_UPLOAD_BYTES,
  PORTAL_MEDIA_UPLOAD_PATH,
  type PortalMediaPurpose,
} from '#/shared/domain/portal-media'

/** What the file picker offers: the formats the server accepts. */
export const PORTAL_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'

const ACCEPTED_TYPES: ReadonlySet<string> = new Set(PORTAL_IMAGE_ACCEPT.split(','))

/** Whether the browser's name for the file's type is one the server accepts. */
export const isAcceptedPortalImageType = (type: string): boolean =>
  ACCEPTED_TYPES.has(type)
const BYTES_PER_MB = 1024 * 1024
const MAX_MB = PORTAL_MEDIA_MAX_UPLOAD_BYTES / BYTES_PER_MB

export type PortalImageUploadInput = Readonly<{
  propertyId: string
  purpose: PortalMediaPurpose
  /** The Portal whose link tile carries the picture; needed for `link_image`. */
  portalId?: string
  /** The uploader's confirmation that they hold the rights to the image. */
  rightsConfirmed: boolean
}>

export type PortalImageUploadResult =
  Readonly<{ ok: true; assetId: string }> | Readonly<{ ok: false; message: string }>

export type PortalImageUploader = (
  input: PortalImageUploadInput,
  file: File,
) => Promise<PortalImageUploadResult>

const MESSAGES = {
  format: 'Use a JPEG, PNG or WebP photo.',
  tooLarge: `That photo is over ${MAX_MB} MB. Choose a smaller one.`,
  empty: 'That file is empty.',
  rights: 'Confirm that you own the photo or have permission to use it.',
  unavailable: 'Photo uploads are not available right now.',
  permission: 'You do not have permission to add photos here.',
  signIn: 'Your session ended. Sign in again, then try the photo again.',
  gone: 'This page no longer exists.',
  rateLimited: 'Too many uploads in a short time. Try again in a few minutes.',
  network: 'The photo could not be sent. Check your connection and try again.',
  failed: 'The photo could not be uploaded. Try again.',
  unusable: 'We could not use that photo. Try another one.',
} as const

/** What the server says about a refused image, in the words a manager needs. */
const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  too_large: MESSAGES.tooLarge,
  unsupported_type: MESSAGES.format,
  type_mismatch:
    "That file isn't really the kind of image its name says. Use a JPEG, PNG or WebP photo.",
  rights_not_confirmed: MESSAGES.rights,
  asset_limit_reached:
    'This property has reached its limit of stored photos. Ask an Account Admin to take unused ones down.',
  empty: MESSAGES.empty,
  animated: 'Use a still photo, not an animation.',
  too_many_pixels: 'That photo is too large in pixels. Choose a smaller one.',
  too_small: 'That photo is too small to stay sharp on a phone. Choose a larger one.',
  extreme_aspect:
    'That photo is too wide or too tall. Choose one that is closer to square.',
  undecodable: 'We could not read that photo. Try another file.',
  output_too_large: 'That photo is too detailed to store. Try a smaller or simpler one.',
}

/**
 * The sentences above talk about a photo, which is what most uploads are. A
 * logo is not one, so what a person reads about a logo says logo.
 */
export function messageFor(purpose: PortalMediaPurpose, message: string): string {
  return purpose === 'logo'
    ? message.replaceAll('stored photos', 'stored images').replaceAll('photo', 'logo')
    : message
}

/** Why a file should not be sent, or null if it may be. The server checks again. */
export function validatePortalImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) return MESSAGES.format
  if (file.size === 0) return MESSAGES.empty
  if (file.size > PORTAL_MEDIA_MAX_UPLOAD_BYTES) return MESSAGES.tooLarge
  return null
}

/** "terrace.jpg · 3.4 MB" for the line under the chosen file. */
export function describePortalImageFile(file: File): string {
  const size =
    file.size >= BYTES_PER_MB
      ? `${Math.round((file.size / BYTES_PER_MB) * 10) / 10} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`
  return `${file.name} · ${size}`
}

/** The refusals that say this person may not add photos here, as against the feature being off. */
const PERMISSION_CODES: ReadonlySet<string> = new Set([
  'forbidden',
  'missing_scope',
  'not_a_member',
])

function messageForRefusal(status: number, body: unknown): string {
  const error = typeof body === 'object' && body !== null ? body : {}
  const code = 'error' in error ? error.error : undefined
  if (code === 'image_rejected') {
    const reason = 'reason' in error ? error.reason : undefined
    return (typeof reason === 'string' && REFUSAL_MESSAGES[reason]) || MESSAGES.unusable
  }
  if (code === 'upload_failed') return MESSAGES.failed
  if (typeof code === 'string' && PERMISSION_CODES.has(code)) return MESSAGES.permission
  if (status === 401) return MESSAGES.signIn
  if (status === 403) return MESSAGES.unavailable
  if (status === 404) return MESSAGES.gone
  if (status === 429) return MESSAGES.rateLimited
  return MESSAGES.failed
}

function assetIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('asset' in body)) return null
  const asset = body.asset
  if (typeof asset !== 'object' || asset === null || !('assetId' in asset)) return null
  return typeof asset.assetId === 'string' && asset.assetId !== '' ? asset.assetId : null
}

/**
 * Sends one image. Resolves, never rejects: a refusal or a broken connection is
 * `{ ok: false, message }` with a sentence fit to show.
 */
export async function uploadPortalImage(
  input: PortalImageUploadInput,
  file: File,
  send: typeof fetch = (...args) => fetch(...args),
): Promise<PortalImageUploadResult> {
  const refused = (message: string) =>
    ({ ok: false, message: messageFor(input.purpose, message) }) as const
  const invalid = validatePortalImageFile(file)
  if (invalid) return refused(invalid)
  if (!input.rightsConfirmed) return refused(MESSAGES.rights)

  const query = new URLSearchParams({
    propertyId: input.propertyId,
    purpose: input.purpose,
    rightsConfirmed: 'true',
    ...(input.portalId ? { portalId: input.portalId } : {}),
  })
  let response: Response
  try {
    response = await send(`${PORTAL_MEDIA_UPLOAD_PATH}?${query.toString()}`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type },
      credentials: 'same-origin',
    })
  } catch {
    return refused(MESSAGES.network)
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) return refused(messageForRefusal(response.status, body))
  const assetId = assetIdOf(body)
  return assetId ? { ok: true, assetId } : refused(MESSAGES.failed)
}
