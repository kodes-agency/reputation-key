import { z } from 'zod'
import {
  AI_REVIEW_ROUTE_MAX_BYTES,
  AI_TREND_ROUTE_MAX_BYTES,
  parseAiInternalJsonBytes,
} from '../../src/shared/ai-internal-transport-contract'
import type { SensitiveSourceLease } from './source-lease'

const INVALID_SOURCE_REQUEST = 'AI gateway source request is invalid'

function fail(): never {
  throw new TypeError(INVALID_SOURCE_REQUEST)
}

function isApplicationJsonUtf8(value: string): boolean {
  return /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*utf-8)?$/i.test(value)
}

function validateRequestHeaders(request: Request, maxBytes: number): number | null {
  if (maxBytes !== AI_REVIEW_ROUTE_MAX_BYTES && maxBytes !== AI_TREND_ROUTE_MAX_BYTES) {
    fail()
  }
  const contentType = request.headers.get('content-type')
  const contentLength = request.headers.get('content-length')
  if (
    contentType === null ||
    !isApplicationJsonUtf8(contentType) ||
    request.headers.has('content-encoding') ||
    request.body === null
  ) {
    fail()
  }
  if (contentLength === null) return null
  if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) fail()
  const parsed = Number(contentLength)
  if (!Number.isSafeInteger(parsed) || parsed > maxBytes) fail()
  return parsed
}

async function cancelRequestBody(
  request: Request,
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
): Promise<void> {
  try {
    if (reader !== null) await reader.cancel()
    else if (request.body !== null) await request.body.cancel()
  } catch {
    // Lease disposal remains authoritative even if the transport is already closed.
  }
}

export async function readGatewaySourceRequest<
  SourceRequest extends Readonly<{ source: object }>,
>(
  request: Request,
  maxBytes: number,
  schema: z.ZodType<SourceRequest>,
  lease: SensitiveSourceLease<SourceRequest>,
): Promise<SensitiveSourceLease<SourceRequest>> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    const declaredLength = validateRequestHeaders(request, maxBytes)
    reader = request.body!.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (true) {
      const next = await reader.read()
      if (next.done) break
      lease.registerOwnedChunk(next.value)
      chunks.push(next.value)
      totalBytes += next.value.byteLength
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // Disposal below remains authoritative even when stream cancellation fails.
        }
        fail()
      }
    }
    if (declaredLength !== null && declaredLength !== totalBytes) fail()
    const combined = new Uint8Array(totalBytes)
    lease.registerOwnedChunk(combined)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }
    const parsed = parseAiInternalJsonBytes(combined, maxBytes, schema)
    lease.attachSource(parsed, (value) => value.source)
    return lease
  } catch {
    await cancelRequestBody(request, reader)
    lease.dispose()
    throw new TypeError(INVALID_SOURCE_REQUEST)
  } finally {
    reader?.releaseLock()
  }
}
