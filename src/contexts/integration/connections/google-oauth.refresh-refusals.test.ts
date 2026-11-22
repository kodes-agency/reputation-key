import { describe, expect, it } from 'vitest'
import { createGoogleOAuthAdapter } from './google-oauth.adapter.server'
import {
  CONFIG,
  authorization,
  executorAdapter,
  executorAnswering,
  executorFailing,
  jsonResponse,
  stubFetch,
} from '#/shared/testing/google-oauth-adapter.test-fixtures'

// Google answers a refresh of a revoked or expired grant with 400
// `invalid_grant`. Every such answer used to read as a generic, retryable
// `token_refresh_failed`, so a connection nobody could use again stayed
// "Connected" and nobody was asked to reconnect it.
describe('Google OAuth refresh refusals', () => {
  const fetchMock = stubFetch()

  const DESCRIPTION = 'Token has been expired or revoked.'

  function refreshAnsweredWith(status: number, body: string) {
    const { execute, responseBody } = executorAnswering(
      status,
      body,
      'application/json; charset=utf-8',
    )
    return { adapter: executorAdapter(execute), responseBody }
  }

  async function refusal(promise: Promise<unknown>): Promise<Error> {
    const outcome = await promise.then(
      () => null,
      (error: unknown) => error,
    )
    expect(outcome).toBeInstanceOf(Error)
    return outcome as Error
  }

  it('reads a 400 invalid_grant answer as a grant that needs reauthorization', async () => {
    const { adapter, responseBody } = refreshAnsweredWith(
      400,
      JSON.stringify({ error: 'invalid_grant', error_description: DESCRIPTION }),
    )

    const failure = await refusal(
      adapter.refreshAccessToken('refresh-token-secret', authorization),
    )

    expect(failure).toMatchObject({
      _tag: 'IntegrationError',
      code: 'reauthorization_required',
    })
    expect(JSON.stringify(failure)).not.toContain(DESCRIPTION)
    expect(failure.message).not.toContain('refresh-token-secret')
    expect([...responseBody].every((byte) => byte === 0)).toBe(true)
  })

  // Both name RepKey's own client, not one tenant's grant: a wrong client ID
  // or secret would otherwise end every connection's grant at once.
  it.each([
    {
      name: 'invalid_client, which is RepKey configuration',
      status: 401,
      body: JSON.stringify({ error: 'invalid_client' }),
    },
    {
      name: 'unauthorized_client, a grant issued to another client',
      status: 400,
      body: JSON.stringify({ error: 'unauthorized_client' }),
    },
    {
      name: 'a 401 unauthorized_client',
      status: 401,
      body: JSON.stringify({ error: 'unauthorized_client' }),
    },
    {
      name: 'a 5xx even when it names invalid_grant',
      status: 503,
      body: JSON.stringify({ error: 'invalid_grant' }),
    },
    { name: 'a 400 without a readable OAuth error', status: 400, body: '<html>' },
  ])('keeps $name a retryable refresh failure', async ({ status, body }) => {
    const { adapter, responseBody } = refreshAnsweredWith(status, body)

    const failure = await refusal(
      adapter.refreshAccessToken('refresh-token', authorization),
    )

    expect(failure).toMatchObject({ code: 'token_refresh_failed' })
    expect([...responseBody].every((byte) => byte === 0)).toBe(true)
  })

  it('keeps a refresh the gateway could not finish retryable', async () => {
    const adapter = executorAdapter(executorFailing('deadline_exceeded'))

    await expect(
      adapter.refreshAccessToken('refresh-token', authorization),
    ).rejects.toMatchObject({ code: 'token_refresh_failed' })
  })

  it('reads refresh refusals through the compiled provider transport the same way', async () => {
    const adapter = createGoogleOAuthAdapter(CONFIG)
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'invalid_grant', error_description: DESCRIPTION },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, { status: 500 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'unauthorized_client' }, { status: 400 }),
      )

    await expect(
      adapter.refreshAccessToken('refresh-token', authorization),
    ).rejects.toMatchObject({ code: 'reauthorization_required' })
    await expect(
      adapter.refreshAccessToken('refresh-token', authorization),
    ).rejects.toMatchObject({ code: 'token_refresh_failed' })
    await expect(
      adapter.refreshAccessToken('refresh-token', authorization),
    ).rejects.toMatchObject({ code: 'token_refresh_failed' })
  })
})
