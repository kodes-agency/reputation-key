import { readFileSync, statSync } from 'node:fs'
import {
  Agent as HttpsAgent,
  createServer,
  request as httpsRequest,
  type RequestOptions,
  type Server,
} from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  checkServerIdentity as checkTlsServerIdentity,
  type DetailedPeerCertificate,
  type TLSSocket,
} from 'node:tls'
import { z } from 'zod/v4'

import {
  isApplicationJsonUtf8,
  parseStrictInternalJsonBytes,
} from '../src/shared/ai-internal-transport-contract'

export type InternalMtlsMaterial = Readonly<{
  ca: Buffer
  cert: Buffer
  key: Buffer
}>

export type InternalPeerIdentityResolver = (
  certificate: DetailedPeerCertificate,
) => string | null

function readTlsFile(path: string): Buffer {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) {
    throw new Error('internal mTLS material is invalid')
  }
  return readFileSync(path)
}

class InternalRequestRejectedError extends Error {}
class InternalPeerRejectedError extends Error {}

function loadInternalMtlsMaterial(
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

function peerIdentity(
  request: IncomingMessage,
  resolver?: InternalPeerIdentityResolver,
): string | null {
  const socket = request.socket as TLSSocket
  if (!socket.authorized) return null
  const certificate = socket.getPeerCertificate(true)
  if (resolver) return resolver(certificate)
  const commonName = certificate.subject?.CN
  return typeof commonName === 'string' && /^[A-Za-z0-9._:@/-]{1,255}$/.test(commonName)
    ? commonName
    : null
}

function decodeBase64Material(value: string): Buffer {
  if (value.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('internal mTLS material is invalid')
  }
  const decoded = Buffer.from(value, 'base64')
  try {
    if (
      decoded.byteLength < 1 ||
      decoded.byteLength > 1024 * 1024 ||
      decoded.toString('base64') !== value
    ) {
      throw new Error('internal mTLS material is invalid')
    }
    return decoded
  } catch {
    decoded.fill(0)
    throw new Error('internal mTLS material is invalid')
  }
}

export function loadInternalMtlsMaterialFromBase64(
  input: Readonly<{ ca: string; cert: string; key: string }>,
): InternalMtlsMaterial {
  const decoded: Buffer[] = []
  try {
    const ca = decodeBase64Material(input.ca)
    decoded.push(ca)
    const cert = decodeBase64Material(input.cert)
    decoded.push(cert)
    const key = decodeBase64Material(input.key)
    decoded.push(key)
    return Object.freeze({ ca, cert, key })
  } catch {
    for (const material of decoded) material.fill(0)
    throw new Error('internal mTLS material is invalid')
  }
}

/**
 * Expand/cutover resolver for platforms that supply secrets either as mounted
 * files or variables. Exactly one complete representation is accepted; a
 * partial or mixed triplet fails before any protected listener is opened.
 */
export function loadInternalMtlsMaterialFromOneSource(
  input: Readonly<{
    path: Readonly<{
      ca?: string
      cert?: string
      key?: string
    }>
    base64: Readonly<{
      ca?: string
      cert?: string
      key?: string
    }>
  }>,
): InternalMtlsMaterial {
  const path = [input.path.ca, input.path.cert, input.path.key]
  const base64 = [input.base64.ca, input.base64.cert, input.base64.key]
  const configuredPaths = path.filter((value): value is string => !!value)
  const configuredBase64 = base64.filter((value): value is string => !!value)

  if (configuredBase64.length === 3 && configuredPaths.length === 0) {
    return loadInternalMtlsMaterialFromBase64({
      ca: configuredBase64[0]!,
      cert: configuredBase64[1]!,
      key: configuredBase64[2]!,
    })
  }
  if (configuredPaths.length === 3 && configuredBase64.length === 0) {
    return loadInternalMtlsMaterial({
      caPath: configuredPaths[0]!,
      certPath: configuredPaths[1]!,
      keyPath: configuredPaths[2]!,
    })
  }
  throw new Error('internal mTLS material must use exactly one complete source')
}

export function createExactSpiffePeerIdentityResolver(
  input: Readonly<{
    uri: string
    dnsName: string | null
    extendedKeyUsages: readonly ('clientAuth' | 'serverAuth')[]
  }>,
): InternalPeerIdentityResolver {
  if (
    !/^spiffe:\/\/repkey\.internal\/[a-z][a-z0-9-]{0,63}$/.test(input.uri) ||
    (input.dnsName !== null && !/^[a-z][a-z0-9-]{0,63}$/.test(input.dnsName)) ||
    input.extendedKeyUsages.length < 1
  ) {
    throw new Error('internal mTLS peer identity policy is invalid')
  }
  const expectedAltNames = [
    ...(input.dnsName === null ? [] : [`DNS:${input.dnsName}`]),
    `URI:${input.uri}`,
  ].sort()
  const usageOids = new Set(
    input.extendedKeyUsages.map((usage) =>
      usage === 'clientAuth' ? '1.3.6.1.5.5.7.3.2' : '1.3.6.1.5.5.7.3.1',
    ),
  )
  return (certificate) => {
    const altNames = certificate.subjectaltname?.split(/,\s*/).sort() ?? []
    const actualUsageOids = new Set(certificate.ext_key_usage ?? [])
    return altNames.length === expectedAltNames.length &&
      altNames.every((value, index) => value === expectedAltNames[index]) &&
      actualUsageOids.size === usageOids.size &&
      [...usageOids].every((oid) => actualUsageOids.has(oid))
      ? input.uri
      : null
  }
}

type IncomingBodyLease = Readonly<{
  body: Buffer
  dispose(): void
}>

async function readIncomingBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<IncomingBodyLease> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  const clearChunks = () => {
    for (const chunk of chunks) chunk.fill(0)
    chunks.length = 0
  }
  try {
    for await (const raw of request) {
      const chunk = Buffer.from(raw)
      if (raw instanceof Uint8Array) raw.fill(0)
      totalBytes += chunk.byteLength
      if (totalBytes > maxBytes) {
        chunk.fill(0)
        request.destroy()
        throw new InternalRequestRejectedError()
      }
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks, totalBytes)
    clearChunks()
    return Object.freeze({
      body,
      dispose: () => body.fill(0),
    })
  } catch (error) {
    clearChunks()
    request.destroy()
    throw error instanceof InternalRequestRejectedError
      ? error
      : new InternalRequestRejectedError()
  }
}

type IncomingStreamLease = Readonly<{
  stream: ReadableStream<Uint8Array>
  dispose(): void
}>

function streamIncomingBody(
  request: IncomingMessage,
  maxBytes: number,
): IncomingStreamLease {
  const iterator = request[Symbol.asyncIterator]()
  const ownedChunks = new Set<Buffer>()
  let totalBytes = 0
  let disposed = false
  const clearOwnedChunks = () => {
    for (const chunk of ownedChunks) chunk.fill(0)
    ownedChunks.clear()
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearOwnedChunks()
    request.destroy()
    void iterator.return?.()
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (disposed) {
        controller.error(new InternalRequestRejectedError())
        return
      }
      try {
        const next = await iterator.next()
        if (next.done) {
          controller.close()
          return
        }
        const raw = next.value
        const chunk = Buffer.from(raw)
        if (raw instanceof Uint8Array) raw.fill(0)
        totalBytes += chunk.byteLength
        if (totalBytes > maxBytes) {
          chunk.fill(0)
          dispose()
          controller.error(new InternalRequestRejectedError())
          return
        }
        ownedChunks.add(chunk)
        controller.enqueue(chunk)
      } catch {
        dispose()
        controller.error(new InternalRequestRejectedError())
      }
    },
    cancel() {
      dispose()
    },
  })
  return Object.freeze({ stream, dispose })
}

async function writeOwnedResponseChunk(
  response: ServerResponse,
  chunk: Uint8Array,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error | null) => {
      if (settled) return
      settled = true
      response.off('error', onError)
      response.off('close', onClose)
      chunk.fill(0)
      if (error) reject(error)
      else resolve()
    }
    const onError = (error: Error) => finish(error)
    const onClose = () => finish(new Error('internal mTLS response closed before flush'))
    response.once('error', onError)
    response.once('close', onClose)
    try {
      response.write(chunk, (error) => finish(error))
    } catch (error) {
      finish(
        error instanceof Error ? error : new Error('internal mTLS response write failed'),
      )
    }
  })
}

export async function writeWebResponse(
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
      await writeOwnedResponseChunk(response, next.value)
    }
    response.end()
  } catch (error) {
    try {
      await reader.cancel(error)
    } catch {
      // The active chunk was already cleared; cancellation is best-effort cleanup.
    }
    throw error
  } finally {
    reader.releaseLock()
  }
}

export type InternalMtlsWebServer = Server &
  Readonly<{
    stopAndDrain(): Promise<void>
  }>

export function createInternalMtlsWebServer(
  input: Readonly<{
    host: string
    port: number
    tls: InternalMtlsMaterial
    maxRequestBytes: number
    handle(request: Request, peerIdentity: string | null): Promise<Response>
    resolvePeerIdentity?: InternalPeerIdentityResolver
    streamRequestBody?: boolean
    shutdownDrainTimeoutMs?: number
    preflight?(
      input: Readonly<{
        method: string
        path: string
        headers: Readonly<Record<string, string | readonly string[] | undefined>>
        peerIdentity: string | null
      }>,
    ): boolean
  }>,
) {
  if (
    !input.host ||
    !Number.isSafeInteger(input.port) ||
    input.port < 1 ||
    input.port > 65_535 ||
    !Number.isSafeInteger(input.maxRequestBytes) ||
    input.maxRequestBytes < 1 ||
    input.maxRequestBytes > 1024 * 1024 ||
    (input.shutdownDrainTimeoutMs !== undefined &&
      (!Number.isSafeInteger(input.shutdownDrainTimeoutMs) ||
        input.shutdownDrainTimeoutMs < 0 ||
        input.shutdownDrainTimeoutMs > 300_000))
  ) {
    throw new Error('internal mTLS server configuration is invalid')
  }
  const activeControllers = new Set<AbortController>()
  const drainedWaiters = new Set<() => void>()
  let draining = false
  let stopPromise: Promise<void> | null = null
  const shutdownDrainTimeoutMs = input.shutdownDrainTimeoutMs ?? 0
  const notifyDrained = () => {
    if (activeControllers.size !== 0) return
    for (const resolve of drainedWaiters) resolve()
    drainedWaiters.clear()
  }
  const server = createServer(
    {
      ca: input.tls.ca,
      cert: input.tls.cert,
      key: input.tls.key,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    },
    async (incoming, outgoing) => {
      const abortController = new AbortController()
      activeControllers.add(abortController)
      if (draining) abortController.abort('server_shutdown')
      const abortRequest = () => abortController.abort()
      let bodyLease: IncomingBodyLease | null = null
      let streamLease: IncomingStreamLease | null = null
      let requestBody: Uint8Array | null = null
      let webRequest: Request | null = null
      const abortOnPrematureClose = () => {
        if (!outgoing.writableEnded) abortController.abort()
      }
      const socket = incoming.socket
      incoming.once('aborted', abortRequest)
      outgoing.once('close', abortOnPrematureClose)
      socket.once('error', abortRequest)
      socket.once('close', abortOnPrematureClose)
      try {
        const method = incoming.method ?? 'GET'
        const resolvedPeerIdentity = peerIdentity(incoming, input.resolvePeerIdentity)
        if (input.resolvePeerIdentity && resolvedPeerIdentity === null) {
          throw new InternalPeerRejectedError()
        }
        if (
          input.preflight &&
          !input.preflight({
            method,
            path: incoming.url ?? '/',
            headers: incoming.headers,
            peerIdentity: resolvedPeerIdentity,
          })
        ) {
          throw new InternalRequestRejectedError()
        }
        const streamBody =
          input.streamRequestBody === true && method !== 'GET' && method !== 'HEAD'
        if (streamBody) {
          streamLease = streamIncomingBody(incoming, input.maxRequestBytes)
        } else if (method !== 'GET' && method !== 'HEAD') {
          bodyLease = await readIncomingBody(incoming, input.maxRequestBytes)
          requestBody = Uint8Array.from(bodyLease.body)
        }
        const headers = new Headers()
        for (const [name, raw] of Object.entries(incoming.headers)) {
          if (Array.isArray(raw)) {
            for (const value of raw) headers.append(name, value)
          } else if (raw !== undefined) {
            headers.set(name, raw)
          }
        }
        webRequest = new Request(`https://internal.invalid${incoming.url ?? '/'}`, {
          method,
          headers,
          body:
            method === 'GET' || method === 'HEAD'
              ? null
              : streamBody
                ? streamLease!.stream
                : requestBody!.buffer,
          ...(streamBody ? { duplex: 'half' } : {}),
          signal: abortController.signal,
        } as RequestInit)
        const response = await input.handle(webRequest, resolvedPeerIdentity)
        await writeWebResponse(outgoing, response)
      } catch (error) {
        if (outgoing.headersSent) {
          outgoing.destroy()
          return
        }
        const peerRejected = error instanceof InternalPeerRejectedError
        const rejected = error instanceof InternalRequestRejectedError
        outgoing.statusCode = peerRejected ? 403 : rejected ? 413 : 503
        outgoing.setHeader('content-type', 'application/json; charset=utf-8')
        outgoing.setHeader('cache-control', 'no-store')
        outgoing.setHeader('x-content-type-options', 'nosniff')
        outgoing.end(
          peerRejected
            ? '{"ok":false,"code":"peer_rejected"}'
            : rejected
              ? '{"ok":false,"code":"request_rejected"}'
              : '{"ok":false,"code":"internal_failure"}',
        )
      } finally {
        if (webRequest?.body && !webRequest.bodyUsed) {
          try {
            await webRequest.body.cancel()
          } catch {
            // Disposal must not replace the closed response already selected.
          }
        }
        streamLease?.dispose()
        bodyLease?.dispose()
        requestBody?.fill(0)
        incoming.removeListener('aborted', abortRequest)
        outgoing.removeListener('close', abortOnPrematureClose)
        socket.removeListener('error', abortRequest)
        socket.removeListener('close', abortOnPrematureClose)
        activeControllers.delete(abortController)
        notifyDrained()
      }
    },
  )
  server.on('checkContinue', (incoming, outgoing) => {
    const resolvedPeerIdentity = peerIdentity(incoming, input.resolvePeerIdentity)
    const accepted =
      (!input.resolvePeerIdentity || resolvedPeerIdentity !== null) &&
      (!input.preflight ||
        input.preflight({
          method: incoming.method ?? 'GET',
          path: incoming.url ?? '/',
          headers: incoming.headers,
          peerIdentity: resolvedPeerIdentity,
        }))
    if (!accepted) {
      outgoing.statusCode = resolvedPeerIdentity === null ? 403 : 400
      outgoing.setHeader('connection', 'close')
      outgoing.setHeader('content-type', 'application/json; charset=utf-8')
      outgoing.setHeader('cache-control', 'no-store')
      outgoing.setHeader('x-content-type-options', 'nosniff')
      outgoing.end(
        resolvedPeerIdentity === null
          ? '{"ok":false,"code":"peer_rejected"}'
          : '{"ok":false,"code":"request_rejected"}',
        () => incoming.destroy(),
      )
      return
    }
    outgoing.writeContinue()
    server.emit('request', incoming, outgoing)
  })
  server.on('clientError', (_error, socket) => {
    socket.destroy()
  })
  server.headersTimeout = 5_000
  server.requestTimeout = input.streamRequestBody === true ? 115_000 : 5_000
  // Must stay well above the caller pool's idle window so a pooled socket is
  // never closed underneath an in-flight reuse (Node does not retry a POST on
  // a reset reused socket). Draining still closes idle sockets immediately.
  server.keepAliveTimeout = 65_000
  server.timeout = input.streamRequestBody === true ? 115_000 : 5_000
  server.maxHeadersCount = 32
  const stopAndDrain = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise
    draining = true
    const closed = new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    if (activeControllers.size > 0) {
      forceTimer = setTimeout(() => {
        for (const controller of activeControllers)
          controller.abort('server_shutdown_timeout')
        server.closeAllConnections()
      }, shutdownDrainTimeoutMs)
      forceTimer.unref()
    }
    const handlersDrained =
      activeControllers.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => drainedWaiters.add(resolve))
    stopPromise = Promise.all([closed, handlersDrained])
      .then(() => undefined)
      .finally(() => {
        clearTimeout(forceTimer)
      })
    return stopPromise
  }
  Object.defineProperty(server, 'stopAndDrain', {
    configurable: false,
    enumerable: false,
    value: stopAndDrain,
    writable: false,
  })
  return server as InternalMtlsWebServer
}

export type InternalMtlsRawResponse = Readonly<{
  status: number
  headers: Headers
  body: Uint8Array
}>

export type InternalMtlsRequestOptions = Readonly<{
  signal?: AbortSignal
  deadlineEpochMillis?: number
}>

export function createBoundedInternalMtlsRequestSignal(
  input: Readonly<{
    timeoutMs: number
    deadlineEpochMillis?: number
    nowEpochMillis: number
    signal?: AbortSignal
  }>,
): Readonly<{ signal: AbortSignal; dispose(): void }> {
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    !Number.isSafeInteger(input.nowEpochMillis) ||
    (input.deadlineEpochMillis !== undefined &&
      (!Number.isSafeInteger(input.deadlineEpochMillis) ||
        input.deadlineEpochMillis <= input.nowEpochMillis))
  ) {
    throw new Error('internal mTLS request deadline is invalid')
  }
  const remainingToCallerDeadline =
    input.deadlineEpochMillis === undefined
      ? input.timeoutMs
      : input.deadlineEpochMillis - input.nowEpochMillis
  const remainingMillis = Math.min(input.timeoutMs, remainingToCallerDeadline)
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort('caller_aborted')
  input.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (input.signal?.aborted) abortFromCaller()
  const timer = setTimeout(() => controller.abort('transport_deadline'), remainingMillis)
  timer.unref()
  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', abortFromCaller)
    },
  })
}

export type InternalMtlsJsonTransport = Readonly<{
  post(
    path: string,
    body: unknown,
    options?: InternalMtlsRequestOptions,
  ): Promise<unknown>
  postRaw(
    path: string,
    body: unknown,
    options?: InternalMtlsRequestOptions,
  ): Promise<InternalMtlsRawResponse>
  postBytesRaw(
    path: string,
    body: Uint8Array,
    options?: InternalMtlsRequestOptions,
  ): Promise<InternalMtlsRawResponse>
  get(path: '/health/ready', options?: InternalMtlsRequestOptions): Promise<unknown>
  close(): void
}>

export function parseInternalMtlsJsonResponse(
  response: InternalMtlsRawResponse,
  maxResponseBytes: number,
): unknown {
  try {
    if (
      response.status !== 200 ||
      response.headers.has('content-encoding') ||
      !isApplicationJsonUtf8(response.headers.get('content-type') ?? '')
    ) {
      throw new Error('internal mTLS response is invalid')
    }
    return parseStrictInternalJsonBytes(response.body, maxResponseBytes, z.unknown())
  } catch {
    throw new Error('internal mTLS response is invalid')
  } finally {
    response.body.fill(0)
  }
}

export function createInternalMtlsJsonTransport(
  input: Readonly<{
    origin: string
    tls: InternalMtlsMaterial
    serverName: string
    timeoutMs?: number
    peerIdentityPolicy: Readonly<{
      uri: string
      dnsName: string
      extendedKeyUsages: readonly ('clientAuth' | 'serverAuth')[]
    }>
    maxResponseBytes?: number
    requestFactory?: typeof httpsRequest
    requestSignalFactory?: typeof createBoundedInternalMtlsRequestSignal
  }>,
): InternalMtlsJsonTransport {
  const serverIdentityResolver = createExactSpiffePeerIdentityResolver(
    input.peerIdentityPolicy,
  )
  const origin = new URL(input.origin)
  const timeoutMs = input.timeoutMs ?? 5_000
  const maxResponseBytes = input.maxResponseBytes ?? 64 * 1024
  const requestFactory = input.requestFactory ?? httpsRequest
  const requestSignalFactory =
    input.requestSignalFactory ?? createBoundedInternalMtlsRequestSignal
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(input.serverName) ||
    input.peerIdentityPolicy.dnsName !== input.serverName ||
    !input.peerIdentityPolicy.extendedKeyUsages.includes('serverAuth') ||
    new Set(input.peerIdentityPolicy.extendedKeyUsages).size !==
      input.peerIdentityPolicy.extendedKeyUsages.length ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 115_000 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 8 * 1024 * 1024
  ) {
    throw new Error('internal mTLS client configuration is invalid')
  }
  // Connection reuse inside one service->service channel: every request
  // otherwise pays a full TLS 1.3 handshake (~0.6s measured on Railway
  // private networking), which dominates interactive latency and burns the
  // permit start-deadline budget. The channel carries a single client
  // identity, so a pooled socket never crosses principals. `keepAliveMsecs`
  // is the TCP probe delay; idle sockets are retired by the peer's
  // `keepAliveTimeout`, which is set well above this pool's idle window.
  const agent = new HttpsAgent({
    keepAlive: true,
    keepAliveMsecs: 1_000,
    maxSockets: 8,
    maxTotalSockets: 8,
    maxFreeSockets: 4,
  })

  const send = async (
    method: 'GET' | 'POST',
    path: string,
    body: unknown | Uint8Array,
    requestOptions: InternalMtlsRequestOptions = {},
  ): Promise<InternalMtlsRawResponse> => {
    if (
      (method === 'GET' && path !== '/health/ready') ||
      (method === 'POST' && !/^\/v1\/[a-z-]{1,32}$/.test(path))
    ) {
      throw new Error('internal mTLS request path is invalid')
    }
    const encoded =
      method === 'POST'
        ? body instanceof Uint8Array
          ? Buffer.from(body)
          : Buffer.from(JSON.stringify(body))
        : Buffer.alloc(0)
    let boundedSignal: ReturnType<typeof createBoundedInternalMtlsRequestSignal> | null =
      null
    try {
      if (
        encoded.byteLength < (method === 'POST' ? 1 : 0) ||
        encoded.byteLength > 256 * 1024
      ) {
        throw new Error('internal mTLS request body exceeded its bound')
      }
      const deadlineEpochMillis = requestOptions.deadlineEpochMillis
      if (
        deadlineEpochMillis !== undefined &&
        (!Number.isSafeInteger(deadlineEpochMillis) || deadlineEpochMillis <= Date.now())
      ) {
        throw new Error('internal mTLS request deadline is invalid')
      }
      if (requestOptions.signal?.aborted) {
        throw new Error('internal mTLS request aborted')
      }
      boundedSignal = requestSignalFactory({
        timeoutMs,
        deadlineEpochMillis,
        nowEpochMillis: Date.now(),
        signal: requestOptions.signal,
      })
      const activeSignal = boundedSignal
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
        checkServerIdentity: (hostname, certificate) => {
          const standardError = checkTlsServerIdentity(hostname, certificate)
          if (standardError) return standardError
          return serverIdentityResolver(certificate as DetailedPeerCertificate) === null
            ? new Error('internal mTLS server identity is invalid')
            : undefined
        },
        agent,
        signal: activeSignal.signal,
        headers:
          method === 'POST'
            ? {
                'content-type': 'application/json; charset=utf-8',
                'content-length': encoded.byteLength,
              }
            : undefined,
      }
      return await new Promise<InternalMtlsRawResponse>((resolve, reject) => {
        let settled = false
        let request: ReturnType<typeof httpsRequest> | null = null
        let response: IncomingMessage | null = null
        const chunks: Buffer[] = []
        let totalBytes = 0
        const clearChunks = () => {
          for (const chunk of chunks) chunk.fill(0)
          chunks.length = 0
          totalBytes = 0
        }
        const detach = () => {
          activeSignal.signal.removeEventListener('abort', onAbort)
          request?.removeListener('error', onRequestError)
          if (response) {
            response.removeListener('data', onData)
            response.removeListener('error', onResponseError)
            response.removeListener('aborted', onResponseAborted)
            response.removeListener('end', onResponseEnd)
            response.removeListener('close', onResponseClose)
          }
        }
        const fail = () => {
          if (settled) return
          settled = true
          detach()
          clearChunks()
          response?.destroy()
          request?.destroy()
          reject(new Error('internal mTLS request failed'))
        }
        const onAbort = () => fail()
        const onRequestError = () => fail()
        const onResponseError = () => fail()
        const onResponseAborted = () => fail()
        const onResponseClose = () => {
          if (!response?.complete) fail()
        }
        const onData = (raw: Buffer) => {
          if (settled) {
            raw.fill(0)
            return
          }
          totalBytes += raw.byteLength
          if (totalBytes > maxResponseBytes) {
            raw.fill(0)
            fail()
            return
          }
          chunks.push(raw)
        }
        const onResponseEnd = () => {
          if (settled || !response?.complete) {
            fail()
            return
          }
          const status = response.statusCode
          if (
            !Number.isSafeInteger(status) ||
            status === undefined ||
            status < 100 ||
            status > 599
          ) {
            fail()
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
          const responseBody = Buffer.concat(chunks, totalBytes)
          settled = true
          detach()
          clearChunks()
          resolve(Object.freeze({ status, headers, body: responseBody }))
        }
        activeSignal.signal.addEventListener('abort', onAbort, { once: true })
        try {
          request = requestFactory(options, (incomingResponse) => {
            if (settled) {
              incomingResponse.destroy()
              return
            }
            response = incomingResponse
            response.on('data', onData)
            response.once('error', onResponseError)
            response.once('aborted', onResponseAborted)
            response.once('end', onResponseEnd)
            response.once('close', onResponseClose)
          })
          request.once('error', onRequestError)
          if (activeSignal.signal.aborted) {
            fail()
            return
          }
          request.end(encoded)
        } catch {
          fail()
        }
      })
    } finally {
      boundedSignal?.dispose()
      encoded.fill(0)
    }
  }
  const parseJson = async (
    response: Promise<InternalMtlsRawResponse>,
  ): Promise<unknown> => parseInternalMtlsJsonResponse(await response, maxResponseBytes)
  return Object.freeze({
    post: (path, body, options) => parseJson(send('POST', path, body, options)),
    postRaw: (path, body, options) => send('POST', path, body, options),
    postBytesRaw: (path, body, options) => send('POST', path, body, options),
    get: (path, options) => parseJson(send('GET', path, null, options)),
    close: () => agent.destroy(),
  })
}
