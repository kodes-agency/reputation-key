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

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedBody> {
  if (!request.body) return { kind: 'ok', bytes: new Uint8Array() }
  const reader = request.body.getReader()
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
  }
}
