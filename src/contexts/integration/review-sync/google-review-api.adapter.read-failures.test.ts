import {
  REPLY_PRE_READ_REFUSAL_OPERATION,
  translatedGoogleReviewApi,
} from '#/contexts/reputation/public-api'
import { describe, expect, it, vi } from 'vitest'
import type { GoogleReviewCursorStore } from './google-review-cursor-store.server'
import {
  CONNECTION_ID,
  ORG_ID,
  PROPERTY_ID,
  RUN_ID,
  answered,
  authorization,
  byTitle,
  connection,
  createAdapter,
  cursorStore,
  getReviewInput,
  jsonAnswer,
  listInput,
  providerReview,
  refused,
  settledError,
} from '#/shared/testing/google-review-api-adapter.test-fixtures'
import { createGoogleReviewApiAdapter } from './google-review-api.adapter.server'

const PLAIN_JSON = { contentType: 'application/json' } as const

// The read RepKey makes right before it publishes a reply uses the review-sync
// authorizer, whose refusals are plain Errors with a closed `code`. For that read
// alone they leave as the one Google call error the write path throws, with
// not-sent evidence; the Review use case decides whether a refusal is the
// reconnect case or an outage to retry.
describe('GoogleReviewApiAdapter reading a review before a reply is published', () => {
  const waitingForConsent = { ...connection, status: 'reauth_required' }
  const refusedWith = (code: string) =>
    vi
      .fn()
      .mockRejectedValue(
        Object.assign(
          new Error(`Google review provider authorization is unavailable: ${code}`),
          { code },
        ),
      )

  it.each(
    byTitle([
      ...['authorization_denied', 'stale_source', 'connection_unusable'].map((code) => ({
        title: `throws a ${code} refusal as a permission_denied that sent nothing`,
        overrides: () => ({
          authorizeProviderCall: refusedWith(code),
          findById: vi.fn().mockResolvedValue(waitingForConsent),
        }),
        expected: {
          _tag: 'GbpApiError',
          operation: REPLY_PRE_READ_REFUSAL_OPERATION,
          code: 'permission_denied',
          dispatch: 'not_sent',
          executionCode: code,
        },
        absent: [],
      })),
      {
        title: 'throws an authorizer outage as an upstream error that sent nothing',
        overrides: () => ({ authorizeProviderCall: refusedWith('runtime_unavailable') }),
        expected: {
          _tag: 'GbpApiError',
          code: 'upstream_error',
          dispatch: 'not_sent',
          executionCode: 'runtime_unavailable',
        },
        absent: [],
      },
      {
        title:
          'throws an unreadable connection after the authorizer allowed the call as an upstream error that sent nothing',
        overrides: () => ({
          findById: vi.fn().mockRejectedValue(new Error('connection pool exhausted')),
        }),
        expected: { _tag: 'GbpApiError', code: 'upstream_error', dispatch: 'not_sent' },
        absent: ['executionCode'],
      },
      {
        title:
          'throws an authorizer failure that carries no closed code as an upstream error',
        overrides: () => ({
          authorizeProviderCall: vi.fn().mockRejectedValue(new Error('socket hang up')),
        }),
        expected: { code: 'upstream_error', dispatch: 'not_sent' },
        absent: [],
      },
      {
        title:
          'throws a connection that is not usable as a permission_denied that sent nothing',
        overrides: () => ({ findById: vi.fn().mockResolvedValue(waitingForConsent) }),
        expected: {
          code: 'permission_denied',
          dispatch: 'not_sent',
          operation: REPLY_PRE_READ_REFUSAL_OPERATION,
        },
        absent: [],
      },
    ]),
  )('%s', async (_title, { overrides, expected, absent }) => {
    const execute = vi.fn()
    const { adapter: api } = createAdapter({ execute, ...overrides() })

    const error = await settledError(
      api.getReview({ ...getReviewInput(), forReplyPublication: true }),
    )

    expect(error).toMatchObject(expected)
    for (const key of absent) {
      expect(error).not.toHaveProperty(key)
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('leaves the refusals of every other read as they were', async () => {
    const { adapter: api } = createAdapter({
      execute: vi.fn(),
      authorizeProviderCall: refusedWith('authorization_denied'),
      findById: vi.fn().mockResolvedValue(waitingForConsent),
    })

    await expect(api.getReview(getReviewInput())).rejects.toMatchObject({
      code: 'authorization_denied',
    })
  })

  // The review-sync authorizer says `connection_unusable` for a connection that
  // waits for a reconnect. A sync read carries that code through untouched, so
  // the review context can end the step quietly.
  it('carries connection_unusable through a sync read untouched', async () => {
    const execute = vi.fn()
    const { adapter: api } = createAdapter({
      execute,
      authorizeProviderCall: refusedWith('connection_unusable'),
      findById: vi.fn().mockResolvedValue(waitingForConsent),
    })

    await expect(api.getReview(getReviewInput())).rejects.toMatchObject({
      code: 'connection_unusable',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reads the review the same way and answers a missing one as not_found', async () => {
    const { api, authorizeProviderCall } = createAdapter({
      execute: answered(404, { body: '' }),
    })

    await expect(
      api.getReview({ ...getReviewInput(), forReplyPublication: true }),
    ).resolves.toEqual({ status: 'not_found' })
    expect(authorizeProviderCall).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      connectionId: CONNECTION_ID,
      sourceEpoch: 17,
    })
  })

  it('refuses any other extra field on the read', async () => {
    const { api } = createAdapter({ execute: vi.fn() })

    await expect(
      api.getReview({
        ...getReviewInput(),
        forReplyPublication: true,
        extra: 1,
      } as never),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })
})

// The snapshot use case retries a `provider_unavailable` or `provider_rate_limited`
// step by its code alone, and waits only as long as the error's `retryAfterMs`. An
// error without that hint is re-run at queue speed (3,225 quota denials in 344 s
// once), and a permanent refusal that is mapped to a retryable code is re-run
// until the run expires. Both read routes must therefore hand over the wait the
// provider plane computed, and must name a refusal as the terminal fact it is.
describe('GoogleReviewApiAdapter backoff on the read routes', () => {
  const MIN_WAIT_MS = 5_000

  describe('listing a page', () => {
    it.each([
      ['a 503', answered(503)],
      [
        'a gateway that could not reach its coordination store',
        refused('admission_denied', { admissionCode: 'coordination_unavailable' }),
      ],
      ['a transport error', refused('transport_error')],
      ['a 200 that is not JSON', answered(200, { contentType: 'text/html' })],
    ])('hands over the provider wait for %s', async (_label, execute) => {
      const { api } = createAdapter({ execute })

      const error = await settledError(api.listReviewsPage(listInput()))

      expect(error.code).toBe('provider_unavailable')
      expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
    })

    // A Property bound to a Location Google no longer has (404) or a request
    // Google calls invalid (400) gets the same answer on every retry. Naming it
    // a retryable outage looped the run until its 12 h expiry (S03-02, B).
    it.each([400, 404])(
      'ends the run on an answered %i: a retry gets the same answer',
      async (status) => {
        const { api } = createAdapter({ execute: answered(status) })

        const error = await settledError(api.listReviewsPage(listInput()))

        expect(error).toMatchObject({
          code: 'provider_rejected',
          recoverable: false,
          failure: { executionCode: null, dispatch: 'answered', providerStatus: status },
        })
        expect(error.retryAfterMs).toBeUndefined()
      },
    )

    it('keeps the wait the provider asked for on an answered 503', async () => {
      const { api } = createAdapter({ execute: answered(503, { retryAfter: '42' }) })

      const error = await settledError(api.listReviewsPage(listInput()))

      expect(error.retryAfterMs).toBe(42_000)
    })
  })

  describe('reading one review', () => {
    it('hands over the wait of an admission denial for quota', async () => {
      const { api } = createAdapter({
        execute: refused('admission_denied', {
          admissionCode: 'quota_exhausted',
          retryAfterMs: 1_200,
        }),
      })

      const error = await settledError(api.getReview(getReviewInput()))

      expect(error.code).toBe('provider_rate_limited')
      expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
    })

    it('hands over the wait Google asked for on an answered 429', async () => {
      const { api } = createAdapter({ execute: answered(429, { retryAfter: '7' }) })

      const error = await settledError(api.getReview(getReviewInput()))

      expect(error.code).toBe('provider_rate_limited')
      expect(error.retryAfterMs).toBe(7_000)
    })

    it.each([
      ['a 503', answered(503)],
      [
        'a gateway that could not reach its coordination store',
        refused('admission_denied', { admissionCode: 'coordination_unavailable' }),
      ],
      ['a 200 that is not JSON', answered(200, { contentType: 'text/html' })],
    ])('hands over the provider wait for %s', async (_label, execute) => {
      const { api } = createAdapter({ execute })

      const error = await settledError(api.getReview(getReviewInput()))

      expect(error.code).toBe('provider_unavailable')
      expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
    })

    it('ends the confirmation on a 400, which Google answers the same on every retry', async () => {
      const { api } = createAdapter({ execute: answered(400) })

      const error = await settledError(api.getReview(getReviewInput()))

      expect(error).toMatchObject({ code: 'provider_rejected', recoverable: false })
      expect(error.retryAfterMs).toBeUndefined()
    })

    it.each([
      ['an answered 401', answered(401)],
      ['an answered 403', answered(403)],
      [
        'a permit that no longer authorizes the call',
        refused('admission_denied', { admissionCode: 'authorization_denied' }),
      ],
    ])(
      'treats %s as the terminal refusal it is, like the list route',
      async (_label, execute) => {
        const { api } = createAdapter({ execute })

        const error = await settledError(api.getReview(getReviewInput()))

        expect(error).toMatchObject({ code: 'authorization_changed', recoverable: false })
        expect(error.retryAfterMs).toBeUndefined()
      },
    )
  })

  // The wait is not the transport's alone: any retryable failure the snapshot
  // use case sees is re-run at queue speed unless it carries one. The cursor
  // store sits on the provider-ephemeral Redis, whose outage fails every page
  // after the first before any provider call is made.
  describe('a retryable failure that is not a provider answer', () => {
    const CURSOR_REF = `v1.${'c'.repeat(43)}`
    const pageWithNext = () =>
      jsonAnswer(
        {
          reviews: [providerReview()],
          totalReviewCount: 2,
          averageRating: 4.5,
          nextPageToken: 'provider-next-page-token',
        },
        PLAIN_JSON,
      )

    it('waits when the cursor store throws while redeeming the page token', async () => {
      const redeem = vi.fn().mockRejectedValue(new Error('redis command timed out'))
      const execute = vi.fn()
      const { api } = createAdapter({
        execute,
        cursors: cursorStore({ redeem }),
      })

      const error = await settledError(api.listReviewsPage(listInput(CURSOR_REF, 1)))

      expect(error).toMatchObject({ code: 'provider_unavailable', recoverable: true })
      expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
      expect(execute).not.toHaveBeenCalled()
    })

    it.each(['unavailable', 'conflict'] as const)(
      'waits when the cursor store answers %s to a redeem',
      async (code) => {
        const redeem = vi.fn().mockResolvedValue({ ok: false, code })
        const { api } = createAdapter({
          execute: vi.fn(),
          cursors: cursorStore({ redeem }),
        })

        const error = await settledError(api.listReviewsPage(listInput(CURSOR_REF, 1)))

        expect(error.code).toBe('provider_unavailable')
        expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
      },
    )

    it('waits when the cursor store cannot publish the next page', async () => {
      const publishNext = vi.fn().mockResolvedValue({ ok: false, code: 'unavailable' })
      const { api } = createAdapter({
        execute: pageWithNext(),
        cursors: cursorStore({ publishNext }),
      })

      const error = await settledError(api.listReviewsPage(listInput()))

      expect(error.code).toBe('provider_unavailable')
      expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
    })

    it('waits when discarding the run cursors throws', async () => {
      const discardRun = vi.fn().mockRejectedValue(new Error('redis command timed out'))
      const { api } = createAdapter({
        execute: vi.fn(),
        cursors: cursorStore({ discardRun }),
      })

      const error = await settledError(
        api.discardReviewCursors({
          organizationId: ORG_ID,
          propertyId: PROPERTY_ID,
          sourceEpoch: 17,
          runId: RUN_ID,
        }),
      )

      expect(error.code).toBe('provider_unavailable')
      expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
    })

    it('waits when the review sync authorizer is not wired', async () => {
      const api = translatedGoogleReviewApi(
        createGoogleReviewApiAdapter({
          connectionRepo: { findById: vi.fn() } as never,
          logger: { warn: vi.fn() } as never,
          cursorStore: cursorStore(),
          executor: { execute: vi.fn() },
          nowMs: () => Date.parse('2026-08-12T12:00:00.000Z'),
        }),
      )

      const error = await settledError(api.listReviewsPage(listInput()))

      expect(error.code).toBe('provider_unavailable')
      expect(error.retryAfterMs).toBeGreaterThanOrEqual(MIN_WAIT_MS)
    })
  })
})

// A routine access-token refresh moves `credentialGeneration` (the connection
// column and the authorization vector) about once an hour and changes nothing a
// cursor binding must protect; a scan that crosses it used to lose its cursor
// (`cursor_binding_mismatch` -> `cursor_failure`) and restart from page 0.
// Reconnect and disconnect move the lifecycle and access versions, which stay
// bound.
describe('GoogleReviewApiAdapter cursor binding across a token refresh', () => {
  const CURSOR_REF = `v1.${'b'.repeat(43)}`
  // A fresh body per call: the adapter zeroes every body it has read.
  const okPage = () =>
    jsonAnswer(
      { reviews: [providerReview()], totalReviewCount: 1, averageRating: 5 },
      PLAIN_JSON,
    )
  const authorizedAt = (credentialGeneration: number) => ({
    accessToken: 'access-token',
    authorization: {
      ...authorization,
      expectedCredentialGeneration: credentialGeneration,
      authorizationVector: Object.freeze({
        propertySourceEpoch: 17,
        credentialGeneration,
      }),
    },
  })
  const redeemedBindings = (cursors: GoogleReviewCursorStore) =>
    vi.mocked(cursors.redeem).mock.calls.map(([input]) => input.authorization)

  it('binds the same cursor authorization before and after a routine refresh', async () => {
    const cursors = cursorStore()
    const { api, findById, authorizeProviderCall } = createAdapter({
      execute: okPage(),
      cursors,
      authorizeProviderCall: vi.fn().mockResolvedValue(authorizedAt(3)),
    })

    await api.listReviewsPage(listInput(CURSOR_REF, 1))
    findById.mockResolvedValue({ ...connection, credentialGeneration: 4 })
    authorizeProviderCall.mockResolvedValue(authorizedAt(4))
    await api.listReviewsPage(listInput(CURSOR_REF, 1))

    const [beforeRefresh, afterRefresh] = redeemedBindings(cursors)
    expect(afterRefresh).toEqual(beforeRefresh)
  })

  it('binds a different cursor authorization once the connection was reconnected', async () => {
    const cursors = cursorStore()
    const { api, findById, authorizeProviderCall } = createAdapter({
      execute: okPage(),
      cursors,
      authorizeProviderCall: vi.fn().mockResolvedValue(authorizedAt(3)),
    })

    await api.listReviewsPage(listInput(CURSOR_REF, 1))
    findById.mockResolvedValue({
      ...connection,
      lifecycleVersion: connection.lifecycleVersion + 1,
      credentialGeneration: 4,
    })
    authorizeProviderCall.mockResolvedValue(authorizedAt(4))
    await api.listReviewsPage(listInput(CURSOR_REF, 1))

    const [beforeReconnect, afterReconnect] = redeemedBindings(cursors)
    expect(afterReconnect).not.toEqual(beforeReconnect)
  })
})
