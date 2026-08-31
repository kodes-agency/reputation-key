import { createServer, type Server } from 'node:http'

const JSON_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
})

const EMPTY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
})

export type SidecarReadinessProbe = (signal: AbortSignal) => Promise<boolean>

export type SidecarPlatformHealthController = Readonly<{
  /** Exact, content-free HTTP boundary used only by the platform probe port. */
  handle(request: Request): Promise<Response>
  /** Stop admitting readiness before protected ingress begins its drain. */
  beginDrain(): void
}>

function assertPort(port: number): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('sidecar platform health port is invalid')
  }
}

/**
 * The ordinary platform probe must never share the protected mTLS listener.
 * Keeping the ports distinct prevents a health exception from becoming an
 * authentication bypass for provider or credential routes.
 */
export function assertSeparatedPlatformHealthPort(
  healthPort: number,
  protectedMtlsPort: number,
): void {
  assertPort(healthPort)
  assertPort(protectedMtlsPort)
  if (healthPort === protectedMtlsPort) {
    throw new Error('sidecar platform health port must be distinct from mTLS port')
  }
}

function json(ok: boolean, status: 200 | 503): Response {
  return new Response(`${JSON.stringify({ ok })}\n`, {
    status,
    headers: JSON_HEADERS,
  })
}

async function boundedReadiness(
  readiness: SidecarReadinessProbe,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const probe = Promise.resolve()
    .then(() => readiness(controller.signal))
    .then(
      (ready) => ready === true,
      () => false,
    )
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      controller.abort('platform_health_timeout')
      resolve(false)
    }, timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([probe, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build the shared sidecar health policy without opening a socket. Readiness
 * is evaluated on every request so a database, Redis, or admission-plane loss
 * after successful boot becomes a 503. Liveness deliberately performs no
 * dependency read. No route, error, dependency name, or release identifier is
 * representable in the response.
 */
export function createSidecarPlatformHealthController(input: {
  readonly readiness: SidecarReadinessProbe
  readonly readinessTimeoutMs: number
}): SidecarPlatformHealthController {
  if (
    !Number.isSafeInteger(input.readinessTimeoutMs) ||
    input.readinessTimeoutMs < 1 ||
    input.readinessTimeoutMs > 30_000
  ) {
    throw new Error('sidecar platform readiness timeout is invalid')
  }

  let draining = false
  return {
    beginDrain: () => {
      draining = true
    },
    handle: async (request) => {
      const url = new URL(request.url)
      if (request.method !== 'GET' || url.search !== '') {
        return new Response(null, { status: 404, headers: EMPTY_HEADERS })
      }
      if (url.pathname === '/health/live') return json(true, 200)
      if (url.pathname !== '/health/ready') {
        return new Response(null, { status: 404, headers: EMPTY_HEADERS })
      }
      if (draining) return json(false, 503)
      const ready = await boundedReadiness(input.readiness, input.readinessTimeoutMs)
      return ready && !draining ? json(true, 200) : json(false, 503)
    },
  }
}

export type SidecarPlatformHealthServer = Readonly<{
  listen(): Promise<void>
  beginDrain(): void
  stop(): Promise<void>
}>

/**
 * Minimal plain-HTTP adapter for Railway's service health check. The service
 * remains private and this listener exposes only the two exact health paths;
 * all protected application traffic stays on the separate mTLS port.
 */
export function createSidecarPlatformHealthServer(input: {
  readonly host: string
  readonly healthPort: number
  readonly protectedMtlsPort: number
  readonly readiness: SidecarReadinessProbe
  readonly readinessTimeoutMs?: number
}): SidecarPlatformHealthServer {
  if (input.host !== '0.0.0.0' && input.host !== '::') {
    throw new Error('sidecar platform health host is invalid')
  }
  assertSeparatedPlatformHealthPort(input.healthPort, input.protectedMtlsPort)
  const controller = createSidecarPlatformHealthController({
    readiness: input.readiness,
    readinessTimeoutMs: input.readinessTimeoutMs ?? 2_000,
  })
  const server: Server = createServer((incoming, outgoing) => {
    const request = new Request(
      `http://platform.invalid${incoming.url?.startsWith('/') ? incoming.url : '/'}`,
      { method: incoming.method ?? 'GET' },
    )
    void controller.handle(request).then(
      async (response) => {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        outgoing.end(await response.text())
      },
      () => {
        outgoing.writeHead(503, JSON_HEADERS)
        outgoing.end('{"ok":false}\n')
      },
    )
  })
  server.headersTimeout = 2_000
  server.requestTimeout = 2_000
  server.keepAliveTimeout = 2_000
  server.maxHeadersCount = 16

  return {
    beginDrain: controller.beginDrain,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.removeListener('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(input.healthPort, input.host)
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve()
          return
        }
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
