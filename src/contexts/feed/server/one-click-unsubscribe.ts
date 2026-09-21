import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import {
  verifyOneClickUnsubscribeToken,
  type OneClickUnsubscribeTarget,
} from '../application/one-click-unsubscribe-token'
import {
  isLandingPageConfirmation,
  unsubscribeLandingPage,
  unsubscribeOutcomePage,
  type OneClickOutcome,
} from './one-click-unsubscribe-page'

const NO_STORE = { 'cache-control': 'no-store' } as const

/**
 * RFC 8058 §3.2: a receiver SHOULD post `multipart/form-data` and MAY post
 * `application/x-www-form-urlencoded`. Accepting only the second answered the
 * preferred encoding with a 400, so pressing Unsubscribe changed nothing. Both
 * bodies are tiny; the cap applies before any parsing.
 */
const ONE_CLICK_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'multipart/form-data',
  'application/x-www-form-urlencoded',
])
const MAX_ONE_CLICK_BODY_BYTES = 4_096

type OneClickRejection = 'unreadable_form' | 'not_one_click'

function empty(status: number): Response {
  return new Response(null, { status, headers: NO_STORE })
}

async function readBoundedBody(
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

async function parseForm(
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<FormData | null> {
  try {
    return await new Response(body, {
      headers: { 'content-type': contentType },
    }).formData()
  } catch {
    return null
  }
}

/**
 * The RFC 8058 §8 example writes its delimiters as the bare declared boundary,
 * without the `--` every multipart delimiter needs. A receiver that copied it
 * sends exactly those bytes, so a body the parser refuses is read once more
 * with those two dashes taken off the declared boundary.
 */
function rfc8058ExampleContentType(contentType: string): string | null {
  const boundary = /;\s*boundary="?([^";\s]+)"?/i.exec(contentType)?.[1]
  return boundary?.startsWith('--')
    ? `multipart/form-data; boundary=${boundary.slice(2)}`
    : null
}

/** Exactly one field, `List-Unsubscribe=One-Click`, as text. */
function isOneClickForm(form: FormData): boolean {
  const entries = [...form.entries()]
  if (entries.length !== 1) return false
  const [name, value] = entries[0]!
  return (
    name === 'List-Unsubscribe' &&
    typeof value === 'string' &&
    value.trim() === 'One-Click'
  )
}

/** Why the body is not an RFC 8058 one-click form, or null when it is one. */
async function oneClickFormRejection(
  request: Request,
): Promise<OneClickRejection | null> {
  const contentType = request.headers.get('content-type') ?? ''
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (
    !ONE_CLICK_MEDIA_TYPES.has(mediaType) ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_ONE_CLICK_BODY_BYTES
  ) {
    return 'unreadable_form'
  }
  const body = await readBoundedBody(request, MAX_ONE_CLICK_BODY_BYTES)
  if (body === null) return 'unreadable_form'
  const fallback =
    mediaType === 'multipart/form-data' ? rfc8058ExampleContentType(contentType) : null
  const form =
    (await parseForm(body, contentType)) ??
    (fallback === null ? null : await parseForm(body, fallback))
  if (form === null) return 'unreadable_form'
  return isOneClickForm(form) ? null : 'not_one_click'
}

export type OneClickUnsubscribePostDeps = Readonly<{
  rawKeys: string | undefined
  logger: LoggerPort
  oneClickUnsubscribe: (target: OneClickUnsubscribeTarget) => Promise<number>
}>

async function applyOneClickRequest(
  deps: OneClickUnsubscribePostDeps,
  request: Request,
): Promise<OneClickOutcome> {
  const { logger, rawKeys } = deps
  if (!rawKeys) {
    logger.error('One-click unsubscribe endpoint is disabled — HMAC keys are unset')
    return 'disabled'
  }

  try {
    const rejection = await oneClickFormRejection(request)
    if (rejection !== null) {
      // Content-free: never the token, never the body.
      logger.warn({ reason: rejection }, 'One-click unsubscribe request rejected')
      return 'invalid_request'
    }

    const token = new URL(request.url).searchParams.get('token') ?? ''
    const target = verifyOneClickUnsubscribeToken(rawKeys, token)
    // Acknowledge invalid/stale tokens so this public capability cannot be
    // used as a signature or retained-row existence oracle.
    if (!target) return 'accepted'

    const scopes = await deps.oneClickUnsubscribe(target)
    logger.info(
      { targetKind: target.kind, scopes },
      'Optional notification email scopes unsubscribed',
    )
    return 'accepted'
  } catch (err) {
    logger.error({ err }, 'One-click unsubscribe preference write failed')
    return 'failed'
  }
}

/** What a mail client's RFC 8058 POST gets back. */
const RFC_8058_RESPONSES: Readonly<Record<OneClickOutcome, () => Response>> = {
  accepted: () => empty(204),
  invalid_request: () =>
    Response.json(
      { error: 'Bad Request', code: 'invalid_unsubscribe_request' },
      { status: 400, headers: NO_STORE },
    ),
  disabled: () =>
    Response.json(
      { error: 'Service Unavailable', code: 'unsubscribe_disabled' },
      { status: 503, headers: NO_STORE },
    ),
  failed: () =>
    Response.json(
      { error: 'Internal Server Error', code: 'unsubscribe_failed' },
      { status: 500, headers: NO_STORE },
    ),
}

export const createOneClickUnsubscribePostHandler =
  (deps: OneClickUnsubscribePostDeps) =>
  async (request: Request): Promise<Response> =>
    trace('notification.oneClickUnsubscribe', async () => {
      const outcome = await applyOneClickRequest(deps, request)
      return isLandingPageConfirmation(request)
        ? unsubscribeOutcomePage(outcome, request)
        : RFC_8058_RESPONSES[outcome]()
    })

/**
 * GET on the List-Unsubscribe URL: a confirm page, never an unsubscribe. Link
 * scanners fetch every URL in a message, so acting on a GET would unsubscribe
 * people who never asked.
 */
export const handleOneClickUnsubscribeGet = (request: Request): Response =>
  unsubscribeLandingPage(request)
