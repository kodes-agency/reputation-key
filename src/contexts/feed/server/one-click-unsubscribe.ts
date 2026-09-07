import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import {
  verifyOneClickUnsubscribeToken,
  type OneClickUnsubscribeTarget,
} from '../application/one-click-unsubscribe-token'

const NO_STORE = { 'cache-control': 'no-store' } as const

function empty(status: number): Response {
  return new Response(null, { status, headers: NO_STORE })
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!request.body) return ''
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
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export type OneClickUnsubscribePostDeps = Readonly<{
  rawKeys: string | undefined
  logger: LoggerPort
  oneClickUnsubscribe: (target: OneClickUnsubscribeTarget) => Promise<number>
}>

export const createOneClickUnsubscribePostHandler =
  (deps: OneClickUnsubscribePostDeps) =>
  async (request: Request): Promise<Response> =>
    trace('notification.oneClickUnsubscribe', async () => {
      const { logger, rawKeys } = deps
      if (!rawKeys) {
        logger.error('One-click unsubscribe endpoint is disabled — HMAC keys are unset')
        return Response.json(
          { error: 'Service Unavailable', code: 'unsubscribe_disabled' },
          { status: 503, headers: NO_STORE },
        )
      }

      try {
        const contentType = request.headers.get('content-type')
        const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
        const declaredLength = Number(request.headers.get('content-length') ?? '0')
        if (
          mediaType !== 'application/x-www-form-urlencoded' ||
          !Number.isSafeInteger(declaredLength) ||
          declaredLength < 0 ||
          declaredLength > 64
        ) {
          return Response.json(
            { error: 'Bad Request', code: 'invalid_unsubscribe_request' },
            { status: 400, headers: NO_STORE },
          )
        }
        const body = await readBoundedBody(request, 64)
        if (body !== 'List-Unsubscribe=One-Click') {
          return Response.json(
            { error: 'Bad Request', code: 'invalid_unsubscribe_request' },
            { status: 400, headers: NO_STORE },
          )
        }

        const token = new URL(request.url).searchParams.get('token') ?? ''
        const target = verifyOneClickUnsubscribeToken(rawKeys, token)
        if (!target) {
          // Acknowledge invalid/stale tokens so this public capability cannot be
          // used as a signature or retained-row existence oracle.
          return empty(204)
        }

        const scopes = await deps.oneClickUnsubscribe(target)
        logger.info(
          { targetKind: target.kind, scopes },
          'Optional notification email scopes unsubscribed',
        )
        return empty(204)
      } catch (err) {
        logger.error({ err }, 'One-click unsubscribe preference write failed')
        return Response.json(
          { error: 'Internal Server Error', code: 'unsubscribe_failed' },
          { status: 500, headers: NO_STORE },
        )
      }
    })
