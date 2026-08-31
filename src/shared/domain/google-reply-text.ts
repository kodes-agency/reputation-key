import { sha256Hex } from './sha256'

/**
 * Frozen cross-context normalization for a manager-authorized Google reply.
 * The digest may cross the Review/Integration boundary; reply text must not be
 * added to an authorization permit or durable provider-control log.
 */
export const GOOGLE_REPLY_NORMALIZATION_VERSION = 'google-reply-v1' as const

export function normalizeGoogleReplyText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/gu, '\n').trim()
}

export function googleReplyTextDigest(text: string): string {
  return sha256Hex(
    `${GOOGLE_REPLY_NORMALIZATION_VERSION}\0${normalizeGoogleReplyText(text)}`,
  )
}
