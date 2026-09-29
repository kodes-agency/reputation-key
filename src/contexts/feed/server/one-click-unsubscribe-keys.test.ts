// A malformed signing keyring makes the one-click endpoint unavailable, the
// same answer as an unset one, instead of a 500 on every mail client's POST.

import { describe, expect, it, vi } from 'vitest'
import { createOneClickUnsubscribePostHandler } from './one-click-unsubscribe'

const request = () =>
  new Request('https://app.example.com/api/notifications/unsubscribe?token=unused', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  })

describe('the one-click endpoint with a malformed keyring', () => {
  it('answers 503 unsubscribe_disabled and says why', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const apply = vi.fn()

    const response = await createOneClickUnsubscribePostHandler({
      rawKeys: '11'.repeat(32),
      logger: logger as never,
      oneClickUnsubscribe: apply,
    })(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'unsubscribe_disabled' })
    expect(apply).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      { problem: 'HMAC keyring entry is malformed' },
      'One-click unsubscribe endpoint is disabled — HMAC keys are malformed',
    )
  })
})
