import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOneClickUnsubscribeToken } from '#/contexts/notification/application/one-click-unsubscribe-token'
import { createOneClickUnsubscribePostHandler } from '#/contexts/notification/server/one-click-unsubscribe'

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

const handleOneClickUnsubscribePost = (request: Request) =>
  createOneClickUnsubscribePostHandler({
    rawKeys: mocks.keys.value,
    logger: mocks.logger as never,
    oneClickUnsubscribe: mocks.apply,
  })(request)

function request(token: string, body = 'List-Unsubscribe=One-Click'): Request {
  return new Request(
    `https://app.example.com/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  )
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

  it('returns a retryable failure when the preference write fails', async () => {
    mocks.apply.mockRejectedValue(new Error('database unavailable'))
    const token = createOneClickUnsubscribeToken(KEYS, TARGET)

    const response = await handleOneClickUnsubscribePost(request(token))

    expect(response.status).toBe(500)
  })
})
