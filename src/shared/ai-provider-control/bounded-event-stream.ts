/** Bound the entire decoded SSE response, including ignored events and unterminated frames. */
export function boundedProviderEventStream(
  response: Response,
  limit: number,
  invalid: (reason: string) => Error,
): Response {
  if (response.headers.has('content-encoding')) throw invalid('content_encoding')
  if (!isEventStreamType(response.headers.get('content-type')))
    throw invalid('content_type')
  if (!response.body) throw invalid('response_body')
  const reader = response.body.getReader()
  let bytes = 0
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            validateUtf8(utf8, undefined, invalid)
            controller.close()
            reader.releaseLock()
            return
          }
          bytes += chunk.value.byteLength
          if (bytes > limit) {
            await reader.cancel()
            throw invalid('response_bytes')
          }
          validateUtf8(utf8, chunk.value, invalid)
          controller.enqueue(chunk.value)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel: (reason) => reader.cancel(reason),
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

function isEventStreamType(value: string | null): boolean {
  const [media, ...parameters] = (value ?? '')
    .toLowerCase()
    .split(';')
    .map((part) => part.trim())
  return (
    media === 'text/event-stream' &&
    parameters.length <= 1 &&
    parameters.every((part) => part === 'charset=utf-8')
  )
}

function validateUtf8(
  decoder: TextDecoder,
  bytes: Uint8Array | undefined,
  invalid: (reason: string) => Error,
): void {
  try {
    decoder.decode(bytes, { stream: bytes !== undefined })
  } catch {
    throw invalid('response_utf8')
  }
}
