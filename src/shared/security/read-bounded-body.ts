// Read a request body without trusting its declared length.
//
// A client may send chunked data with no content-length, or lie about it, so the
// bytes are counted as they arrive and the read stops the moment the budget is
// spent. Returns null when the body is too large or the stream fails; the caller
// decides what that means (a 413, a refusal).

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array()
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
        return null
      }
      chunks.push(chunk.value)
    }
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}
