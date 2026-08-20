import { createServer, type IncomingMessage } from 'node:http'

const MAX_BODY_BYTES = 5 * 1024 * 1024
const targetOrigin = new URL(
  process.env.PROVIDER_CONTROL_TARGET ?? 'http://provider-sandbox:4100',
)

if (targetOrigin.pathname !== '/' || targetOrigin.search || targetOrigin.hash) {
  throw new Error('provider control proxy target must be an origin')
}

async function readBoundedBody(message: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of message) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large')
    chunks.push(chunk)
  }
  return size === 0 ? undefined : Buffer.concat(chunks, size)
}

async function readBoundedResponse(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    const chunk = Buffer.from(next.value)
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new Error('response_too_large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://control.invalid')
    if (!url.pathname.startsWith('/__control/')) {
      response.writeHead(404, { 'cache-control': 'no-store' }).end()
      return
    }
    const body = await readBoundedBody(request)
    const upstream = await fetch(new URL(`${url.pathname}${url.search}`, targetOrigin), {
      method: request.method,
      headers: request.headers['content-type']
        ? { 'content-type': request.headers['content-type'] }
        : undefined,
      body: body ? new Uint8Array(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    const responseBody = await readBoundedResponse(upstream)
    response.writeHead(upstream.status, {
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    })
    response.end(responseBody)
  } catch {
    response.writeHead(503, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    response.end('{"ok":false}')
  }
})

server.listen(Number(process.env.PORT ?? '4100'), process.env.HOST ?? '0.0.0.0')

function shutdown(): void {
  server.close(() => process.exit(0))
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
