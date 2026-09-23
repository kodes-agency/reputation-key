import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOneClickUnsubscribeToken } from '#/contexts/feed/application/one-click-unsubscribe-token'
import { createOneClickUnsubscribePostHandler } from '#/contexts/feed/server/one-click-unsubscribe'
import { Route } from './unsubscribe'

const KEYS = `v1:${'11'.repeat(32)}`
const TARGET = {
  kind: 'email' as const,
  id: '86000000-0000-4000-8000-000000000011',
}

const mocks = vi.hoisted(() => ({
  keys: { value: undefined as string | undefined },
  apply: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, callback: () => Promise<unknown>) => callback(),
}))
vi.mock('#/shared/observability/logger', () => ({ getLogger: () => mocks.logger }))
vi.mock('#/shared/config/request-runtime-config', () => ({
  requestRuntimeConfig: () => ({ notificationUnsubscribeHmacKeys: mocks.keys.value }),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({ feedPublicApi: { oneClickUnsubscribe: mocks.apply } }),
}))

type RouteHandler = (context: { request: Request }) => Promise<Response> | Response

/** The handlers the file route really registers, not a re-assembled copy. */
const route = (method: 'GET' | 'POST') => (request: Request) =>
  (Route.options as unknown as { server: { handlers: Record<string, RouteHandler> } })
    .server.handlers[method]!({ request })

const handleOneClickUnsubscribePost = (request: Request) =>
  createOneClickUnsubscribePostHandler({
    rawKeys: mocks.keys.value,
    logger: mocks.logger as never,
    oneClickUnsubscribe: mocks.apply,
  })(request)

const url = (token: string) =>
  `https://app.example.com/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`

function request(token: string, body = 'List-Unsubscribe=One-Click'): Request {
  return new Request(url(token), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

/** A multipart POST built by the platform, the way a mail receiver's HTTP client does. */
function multipartRequest(token: string, fill: (form: FormData) => void): Request {
  const form = new FormData()
  fill(form)
  return new Request(url(token), { method: 'POST', body: form })
}

describe('RFC 8058 one-click unsubscribe route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.keys.value = KEYS
    mocks.apply.mockResolvedValue(1)
  })

  it('stays fail-closed when the signing keyring is absent', async () => {
    mocks.keys.value = undefined

    const response = await handleOneClickUnsubscribePost(request('unused'))

    expect(response.status).toBe(503)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('requires the exact RFC 8058 form field', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(
      request(token, 'List-Unsubscribe=No'),
    )

    expect(response.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('rejects extra form fields and the wrong media type', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)
    const extra = await handleOneClickUnsubscribePost(
      request(token, 'List-Unsubscribe=One-Click&confirm=yes'),
    )
    const wrongType = await handleOneClickUnsubscribePost(
      new Request(
        `https://app.example.com/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
        { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' },
      ),
    )

    expect(extra.status).toBe(400)
    expect(wrongType.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('applies the multipart/form-data POST RFC 8058 says receivers SHOULD send', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(
      multipartRequest(token, (form) => form.append('List-Unsubscribe', 'One-Click')),
    )

    expect(response.status).toBe(204)
    expect(mocks.apply).toHaveBeenCalledWith(TARGET)
  })

  it('applies the RFC 8058 section 8 example exactly as the RFC prints it', async () => {
    // The RFC writes its delimiters as the bare declared boundary, without the
    // `--` multipart requires (hence its Content-Length of 124). A receiver
    // that copied the example sends precisely these bytes.
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)
    const body = [
      '---FormBoundaryjWmhtjORrn',
      'Content-Disposition: form-data; name="List-Unsubscribe"',
      '',
      'One-Click',
      '---FormBoundaryjWmhtjORrn--',
    ].join('\r\n')

    const response = await handleOneClickUnsubscribePost(
      new Request(url(token), {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=---FormBoundaryjWmhtjORrn',
        },
        body,
      }),
    )

    expect(Buffer.byteLength(body)).toBe(124)
    expect(response.status).toBe(204)
    expect(mocks.apply).toHaveBeenCalledWith(TARGET)
  })

  it('tolerates the line break a sender leaves after the urlencoded field', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(
      request(token, 'List-Unsubscribe=One-Click\r\n'),
    )

    expect(response.status).toBe(204)
    expect(mocks.apply).toHaveBeenCalledWith(TARGET)
  })

  it('refuses a multipart body that is not exactly the one-click field', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)
    const asFile = await handleOneClickUnsubscribePost(
      multipartRequest(token, (form) =>
        form.append('List-Unsubscribe', new Blob(['One-Click']), 'one-click.txt'),
      ),
    )
    const extra = await handleOneClickUnsubscribePost(
      multipartRequest(token, (form) => {
        form.append('List-Unsubscribe', 'One-Click')
        form.append('confirm', 'yes')
      }),
    )
    const malformed = await handleOneClickUnsubscribePost(
      new Request(url(token), {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=abc' },
        body: 'List-Unsubscribe=One-Click',
      }),
    )

    expect([asFile.status, extra.status, malformed.status]).toEqual([400, 400, 400])
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      { reason: 'unreadable_form' },
      'One-click unsubscribe request rejected',
    )
  })

  it('refuses an oversized body before parsing it', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(
      multipartRequest(token, (form) => {
        form.append('List-Unsubscribe', 'One-Click')
        form.append('padding', 'x'.repeat(8_192))
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('acknowledges an invalid bearer capability without exposing a token oracle', async () => {
    const response = await handleOneClickUnsubscribePost(request('not-a-token'))

    expect(response.status).toBe(204)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('applies a valid capability without requiring a login session', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(request(token))

    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.apply).toHaveBeenCalledWith(TARGET)
  })

  it('warns, without changing the answer, when a valid capability matched nothing', async () => {
    // A silent 204 that changed no preference reads as a working unsubscribe.
    mocks.apply.mockResolvedValue(0)
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(request(token))

    expect(response.status).toBe(204)
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      { targetKind: 'email', scopes: 0 },
      'One-click unsubscribe matched no optional scope',
    )
  })

  it('returns a retryable failure when the preference write fails', async () => {
    mocks.apply.mockRejectedValue(new Error('database unavailable'))
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(request(token))

    expect(response.status).toBe(500)
  })
})

describe('List-Unsubscribe landing page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.keys.value = KEYS
    mocks.apply.mockResolvedValue(1)
  })

  const landing = async (token: string) => route('GET')(new Request(url(token)))

  /** Submit the landing page's own form the way a browser would. */
  const submitLandingForm = async (token: string) => {
    const html = await (await landing(token)).text()
    const action = /<form method="post" action="([^"]+)">/.exec(html)?.[1]
    const field = /<input type="hidden" name="([^"]+)" value="([^"]+)">/.exec(html)
    if (!action || !field) throw new Error('the landing page has no confirm form')
    return route('POST')(
      new Request(new URL(action.replaceAll('&amp;', '&'), url(token)), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `${field[1]}=${field[2]}`,
      }),
    )
  }

  it('offers a confirm form and never unsubscribes on a GET, which link scanners send', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await landing(token)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const html = await response.text()
    expect(html).toContain('<form method="post" action="/api/notifications/unsubscribe?')
    expect(html).toContain(
      '<input type="hidden" name="List-Unsubscribe" value="One-Click">',
    )
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('renders the same page for a valid and an invalid token', async () => {
    const valid = createOneClickUnsubscribeToken(KEYS, TARGET)
    const page = async (token: string) =>
      (await (await landing(token)).text()).replace(encodeURIComponent(token), 'TOKEN')

    expect(await page(valid)).toBe(await page('not-a-token'))
  })

  it('escapes whatever arrives in the token parameter', async () => {
    const html = await (await landing('"><script>alert(1)</script>')).text()

    expect(html).not.toContain('<script')
  })

  it('unsubscribes from the form and answers the browser with a page, not an empty 204', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await submitLandingForm(token)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('Unsubscribe request received')
    expect(mocks.apply).toHaveBeenCalledWith(TARGET)
  })

  it('answers a stale token from the form with the same page and no write', async () => {
    const valid = await (
      await submitLandingForm(createOneClickUnsubscribeToken(KEYS, TARGET))
    ).text()
    vi.clearAllMocks()

    const stale = await submitLandingForm('not-a-token')

    expect(stale.status).toBe(200)
    expect(await stale.text()).toBe(valid)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('offers a retry page when the preference write fails', async () => {
    mocks.apply.mockRejectedValue(new Error('database unavailable'))

    const response = await submitLandingForm(createOneClickUnsubscribeToken(KEYS, TARGET))

    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('<form method="post"')
  })

  it('keeps the RFC 8058 answer for a mail client posting to the header URL', async () => {
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await route('POST')(request(token))

    expect(response.status).toBe(204)
    expect(mocks.apply).toHaveBeenCalledWith(TARGET)
  })
})
