// The provider request a digest batch was frozen with, as stored beside it.
//
// A retry of a batch the provider may already hold re-sends this request
// verbatim under the batch's key. It is read back only when it still
// fingerprints to the batch's content digest: anything else — a malformed
// value, or one that does not match — reads as absent, and the retry falls
// back to re-rendering and comparing, which fails closed.

import { z } from 'zod/v4'
import type { FrozenDigestRequest } from '../domain/notification-email-queue-types'
import { digestProviderRequest } from './digest-batch-identity'
import { copyFrozenRequestBase, frozenRequestBaseShape } from './frozen-request-base'

const frozenDigestRequestSchema = z.object(frozenRequestBaseShape)

export function readFrozenDigestRequest(
  stored: unknown,
  contentDigest: string,
): FrozenDigestRequest | null {
  const parsed = frozenDigestRequestSchema.safeParse(stored)
  if (!parsed.success) return null
  return digestProviderRequest(parsed.data) === contentDigest ? parsed.data : null
}

/** Exactly the fields the content digest covers, and nothing else. */
export const frozenDigestRequest = (request: FrozenDigestRequest): FrozenDigestRequest =>
  copyFrozenRequestBase(request)
