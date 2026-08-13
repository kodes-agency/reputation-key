import { readFileSync, statSync } from 'node:fs'
import { createServer, request as httpsRequest, type RequestOptions } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TLSSocket } from 'node:tls'

export type InternalMtlsMaterial = Readonly<{
  ca: Buffer
  cert: Buffer
  key: Buffer
}>

function readTlsFile(path: string): Buffer {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) {
    throw new Error('internal mTLS material is invalid')
  }
  return readFileSync(path)
}

class InternalRequestRejectedError extends Error {}

export function loadInternalMtlsMaterial(
  input: Readonly<{
    caPath: string
    certPath: string
    keyPath: string
  }>,
): InternalMtlsMaterial {
  if (!input.caPath || !input.certPath || !input.keyPath) {
    throw new Error('internal mTLS material is not configured')
  }
  return Object.freeze({
    ca: readTlsFile(input.caPath),
    cert: readTlsFile(input.certPath),
    key: readTlsFile(input.keyPath),
  })
}

function peerCommonName(request: IncomingMessage): string | null {
  const socket = request.socket as TLSSocket
  if (!socket.authorized) return null
  const certificate = socket.getPeerCertificate()
  const commonName = certificate.subject?.CN
  return typeof commonName === 'string' && /^[A-Za-z0-9._:@/-]{1,255}$/.test(commonName)
    ? commonName
    : null
}

async function readIncomingBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    totalBytes += chunk.byteLength
    if (totalBytes > maxBytes) {
      throw new InternalRequestRejectedError()
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, totalBytes)
}

async function writeWebResponse(
  response: ServerResponse,
  webResponse: Response,
): Promise<void> {
  response.statusCode = webResponse.status
  for (const [name, value] of webResponse.headers) response.setHeader(name, value)
  if (!webResponse.body) {
    response.end()
    return
  }
  const reader = webResponse.body.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!response.write(Buffer.from(next.value))) {
        await new Promise<void>((resolve, reject) => {
          response.once('drain', resolve)
          response.once('error', reject)
        })
      }
    }
    response.end()
  } finally {
    reader.releaseLock()
  }
}

export function createInternalMtlsWebServer(
  input: Readonly<{
    host: string
    port: number
    tls: InternalMtlsMaterial
    maxRequestBytes: number
    handle(request: Request, peerIdentity: string | null): Promise<Response>
  }>,
) {
  if (
    !input.host ||
    !Number.isSafeInteger(input.port) ||
    input.port < 1 ||
    input.port > 65_535 ||
    !Number.isSafeInteger(input.maxRequestBytes) ||
    input.maxRequestBytes < 1 ||
    input.maxRequestBytes > 1024 * 1024
  ) {
    throw new Error('internal mTLS server configuration is invalid')
  }
  return createServer(
    {
      ca: input.tls.ca,
      cert: input.tls.cert,
      key: input.tls.key,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    },
    async (incoming, outgoing) => {
      try {
        const body = await readIncomingBody(incoming, input.maxRequestBytes)
        const headers = new Headers()
        for (const [name, raw] of Object.entries(incoming.headers)) {
          if (Array.isArray(raw)) {
            for (const value of raw) headers.append(name, value)
          } else if (raw !== undefined) {
            headers.set(name, raw)
          }
        }
        const requestBody = Uint8Array.from(body).buffer
        const method = incoming.method ?? 'GET'
        const request = new Request(`https://internal.invalid${incoming.url ?? '/'}`, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? null : requestBody,
        })
        const response = await input.handle(request, peerCommonName(incoming))
        await writeWebResponse(outgoing, response)
      } catch (error) {
        if (outgoing.headersSent) {
          outgoing.destroy()
          return
        }
        const rejected = error instanceof InternalRequestRejectedError
        outgoing.statusCode = rejected ? 413 : 503
        outgoing.setHeader('content-type', 'application/json; charset=utf-8')
        outgoing.setHeader('cache-control', 'no-store')
        outgoing.setHeader('x-content-type-options', 'nosniff')
        outgoing.end(
          rejected
            ? '{"ok":false,"code":"request_rejected"}'
            : '{"ok":false,"code":"internal_failure"}',
        )
      }
    },
  )
}

export type InternalMtlsRawResponse = Readonly<{
  status: number
  headers: Headers
  body: Uint8Array
}>

export type InternalMtlsJsonTransport = Readonly<{
  post(path: string, body: unknown): Promise<unknown>
  postRaw(path: string, body: unknown): Promise<InternalMtlsRawResponse>
  get(path: '/health/ready'): Promise<unknown>
}>

export function createInternalMtlsJsonTransport(
  input: Readonly<{
    origin: string
    tls: InternalMtlsMaterial
    serverName: string
    timeoutMs?: number
    maxResponseBytes?: number
  }>,
): InternalMtlsJsonTransport {
  const origin = new URL(input.origin)
  const timeoutMs = input.timeoutMs ?? 5_000
  const maxResponseBytes = input.maxResponseBytes ?? 64 * 1024
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(input.serverName) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 8 * 1024 * 1024
  ) {
    throw new Error('internal mTLS client configuration is invalid')
  }

  const send = async (
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
  ): Promise<InternalMtlsRawResponse> => {
    if (
      (method === 'GET' && path !== '/health/ready') ||
      (method === 'POST' && !/^\/v1\/[a-z-]{1,32}$/.test(path))
    ) {
      throw new Error('internal mTLS request path is invalid')
    }
    const encoded =
      method === 'POST' ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0)
    if (encoded.byteLength > 256 * 1024) {
      throw new Error('internal mTLS request body exceeded its bound')
    }
    const options: RequestOptions = {
      protocol: 'https:',
      hostname: origin.hostname,
      port: origin.port ? Number(origin.port) : 443,
      path,
      method,
      servername: input.serverName,
      ca: input.tls.ca,
      cert: input.tls.cert,
      key: input.tls.key,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      signal: AbortSignal.timeout(timeoutMs),
      headers:
        method === 'POST'
          ? {
              'content-type': 'application/json; charset=utf-8',
              'content-length': encoded.byteLength,
            }
          : undefined,
    }
    const result = Promise.withResolvers<InternalMtlsRawResponse>()
    const request = httpsRequest(options, (response) => {
      const chunks: Buffer[] = []
      let totalBytes = 0
      response.on('data', (raw: Buffer) => {
        totalBytes += raw.byteLength
        if (totalBytes > maxResponseBytes) {
          response.destroy(new Error('internal mTLS response exceeded its bound'))
          return
        }
        chunks.push(raw)
      })
      response.once('error', () => {
        result.reject(new Error('internal mTLS request failed'))
      })
      response.once('end', () => {
        const status = response.statusCode
        if (
          !Number.isSafeInteger(status) ||
          status === undefined ||
          status < 100 ||
          status > 599
        ) {
          result.reject(new Error('internal mTLS response is invalid'))
          return
        }
        const headers = new Headers()
        for (const [name, raw] of Object.entries(response.headers)) {
          if (Array.isArray(raw)) {
            for (const value of raw) headers.append(name, value)
          } else if (raw !== undefined) {
            headers.set(name, String(raw))
          }
        }
        result.resolve(
          Object.freeze({
            status,
            headers,
            body: Uint8Array.from(Buffer.concat(chunks, totalBytes)),
          }),
        )
      })
    })
    request.once('error', () => {
      result.reject(new Error('internal mTLS request failed'))
    })
    request.end(encoded)
    return result.promise
  }

  const parseJson = async (
    response: Promise<InternalMtlsRawResponse>,
  ): Promise<unknown> => {
    try {
      return JSON.parse(new TextDecoder().decode((await response).body))
    } catch {
      throw new Error('internal mTLS response is invalid')
    }
  }

  return Object.freeze({
    post: (path, body) => parseJson(send('POST', path, body)),
    postRaw: (path, body) => send('POST', path, body),
    get: (path) => parseJson(send('GET', path, null)),
  })
}
