import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'
import type { AiReplyBrandProfile } from './ai-reply-brand-profile'

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u

export function digestAiReplyBrandDisplayName(displayName: string): string {
  if (
    displayName !== displayName.trim() ||
    displayName.length === 0 ||
    displayName.length > 120 ||
    displayName.normalize('NFKC') !== displayName ||
    CONTROL_OR_FORMAT.test(displayName)
  ) {
    throw new TypeError('AI Reply Brand display name is invalid')
  }
  return createHash('sha256')
    .update('repkey-ai-reply-brand-display-name-v1\0', 'utf8')
    .update(displayName, 'utf8')
    .digest('hex')
}

export function aiReplyBrandProfile(
  value: Readonly<{ displayName: string; version: number }>,
): AiReplyBrandProfile {
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    throw new TypeError('AI Reply Brand Profile version is invalid')
  }
  return Object.freeze({
    displayName: value.displayName,
    version: value.version,
    displayNameDigest: digestAiReplyBrandDisplayName(value.displayName),
  })
}
