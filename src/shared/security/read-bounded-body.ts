// Read a request body without trusting its declared length.
//
// A client may send chunked data with no content-length, or lie about it, so the
// bytes are counted as they arrive and the read stops the moment the budget is
// spent. The result says which way it ended: read, over the budget, or a stream
// that failed (a client that disconnected is not an oversized body).

export type BoundedBody =
  | Readonly<{ kind: 'ok'; bytes: Uint8Array<ArrayBuffer> }>
  | Readonly<{ kind: 'too_large' }>
  | Readonly<{ kind: 'failed' }>

/**
 * The same bounded read for any byte stream; a missing stream is an empty body.
 * `zeroChunks` wipes the raw chunks once the read ends, for bodies that carry secrets.
 */
export async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  options: Readonly<{ zeroChunks?: boolean }> = {},
): Promise<BoundedBody> {
  if (!stream) return { kind: 'ok', bytes: new Uint8Array() }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        return { kind: 'too_large' }
      }
      chunks.push(chunk.value)
    }
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { kind: 'ok', bytes: body }
  } catch {
    return { kind: 'failed' }
  } finally {
    reader.releaseLock()
    if (options.zeroChunks) for (const chunk of chunks) chunk.fill(0)
  }
}

export function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedBody> {
  return readBoundedStream(request.body, maxBytes)
}
