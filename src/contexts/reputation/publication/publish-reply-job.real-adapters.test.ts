import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  createGoogleAuthorizedProviderExecutor,
  createSingle401RefreshExecutor,
} from '#/contexts/integration/provider/google-client.server'
import { createGoogleReviewApiAdapter } from '#/contexts/integration/review-sync/google-review-api.adapter.server'
import { integrationError } from '#/contexts/integration/domain/errors'
import { createReplyPublicationProviderCall } from '#/contexts/integration/review-sync/google-reply-publication-authorizer.server'
import type { GoogleReplyPublicationAuthorizationResult } from '#/contexts/integration/review-sync/google-reply-publication-authorizer.server'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { createPublishReplyHandler } from './publish-reply-job.server'
import {
  NOW,
  JOB_DATA,
  approvedReply,
  review,
  makeDeps,
  makeJob,
} from './publish-reply-job.test-fixtures'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

// A reply with line feeds end to end: the publish job over the REAL review API
// adapter and the REAL authorized executor (so the real route-catalogue
// compile runs); only permit admission and the egress gateway are fakes, so
// nothing can reach Google. The reply carries three line feeds.
describe('publish-reply job over the real provider adapters (line-feed reply)', () => {
  const ORG = '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC'
  const IDS = {
    property: '00000000-0000-4000-8000-00000000a001',
    connection: '00000000-0000-4000-8000-00000000a002',
    review: '00000000-0000-4000-8000-00000000a003',
    reply: '00000000-0000-4000-8000-00000000a004',
  }
  const INCIDENT_TEXT =
    'Thank you for staying with us.\nWe are glad the room was quiet.\nSee you next time!\n'
  // The route catalogue refuses every C0 control in a header field, so this
  // credential makes the REAL compile step refuse the request, as the incident
  // reply's body was refused before line feeds were allowed in the comment.
  const UNCOMPILABLE_TOKEN = `ya29.access${String.fromCharCode(1)}token`

  function incidentDeps(
    accessToken = 'ya29.access-token',
    refusal: GoogleReplyPublicationAuthorizationResult | null = null,
  ) {
    const deps = makeDeps()
    let current = {
      ...approvedReply,
      id: IDS.reply,
      reviewId: IDS.review,
      organizationId: ORG,
      text: INCIDENT_TEXT,
    }
    deps.replyRepo.findById.mockImplementation(async () => current)
    deps.replyCommandStore.markPublicationSending.mockImplementation(async () => {
      if (current.publicationState !== 'authorized') return null
      current = {
        ...current,
        publicationState: 'sending',
        publicationAttempts: current.publicationAttempts + 1,
      }
      return current
    })
    deps.reviewRepo.findById.mockResolvedValue({
      ...review,
      id: IDS.review,
      organizationId: ORG,
      propertyId: IDS.property,
      googleConnectionId: IDS.connection,
    })
    const gateway = {
      execute: vi.fn(async () => ({
        ok: true as const,
        status: 200,
        headers: {
          contentType: 'application/json; charset=utf-8',
          cacheControl: null,
          retryAfter: null,
          providerCorrelationId: 'google-request-1',
        },
        body: new TextEncoder().encode('{}'),
      })),
    }
    const admit = vi.fn(async () => ({ ok: true as const, permitId: 'permit-1' }))
    const executor = createGoogleAuthorizedProviderExecutor({
      bindCredential: (credential) =>
        createHash('sha256').update(credential, 'utf8').digest('hex'),
      admit,
      gateway,
    })
    const googleReviewApi = createGoogleReviewApiAdapter({
      connectionRepo: { findById: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      cursorStore: {} as never,
      executor,
      authorizeReplyPublicationProviderCall: vi.fn(async (input) =>
        refusal
          ? createReplyPublicationProviderCall(async () => refusal)(input)
          : {
              accessToken,
              authorization: {
                capability: 'property.publish_reply' as const,
                organizationId: input.organizationId,
                propertyId: input.propertyId,
                connectionId: input.connectionId,
                initiatorUserId: null,
                expectedCredentialGeneration: 1,
                authorizationVector: {
                  generation: 1,
                  propertySourceEpoch: input.sourceEpoch,
                  publicationCycle: input.publicationCycle,
                  publicationAttemptNumber: input.attemptNumber,
                  expectedReplyDigest: googleReplyTextDigest(INCIDENT_TEXT),
                },
                publication: {
                  reviewId: input.reviewId,
                  replyId: input.replyId,
                  publicationCycle: input.publicationCycle,
                  attemptNumber: input.attemptNumber,
                  sourceEpoch: input.sourceEpoch,
                  materialReviewRevision: input.materialReviewRevision,
                },
              },
            },
      ),
      nowMs: () => NOW.getTime(),
    })
    const getReview = vi.fn(googleReviewApi.getReview)
    const handler = createPublishReplyHandler({
      ...deps,
      googleReviewApi: { ...googleReviewApi, getReview },
    } as never)
    const job = makeJob(0, {
      ...JOB_DATA,
      replyId: IDS.reply,
      organizationId: ORG,
      propertyId: IDS.property,
    })
    return { deps, handler, gateway, admit, getReview, job }
  }

  it('sends the line-feed reply once and waits for observation, never ambiguous', async () => {
    const { deps, handler, gateway, getReview, job } = incidentDeps()

    await expect(handler(job)).resolves.toBeUndefined()

    expect(gateway.execute).toHaveBeenCalledOnce()
    expect(gateway.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          routeKey: 'reviews.reply',
          comment: INCIDENT_TEXT,
        }),
      }),
    )
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).toHaveBeenCalledOnce()
    expect(getReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('a real compile refusal ends terminal on attempt 1: no permit, no fetch, no readback', async () => {
    const { deps, handler, gateway, admit, getReview, job } =
      incidentDeps(UNCOMPILABLE_TOKEN)

    await expect(handler(job)).resolves.toBeUndefined()

    expect(admit).not.toHaveBeenCalled()
    expect(gateway.execute).not.toHaveBeenCalled()
    expect(getReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
      'terminal_rejection',
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
    expect(deps.logger.error).toHaveBeenCalledWith(
      {
        attempt: 1,
        failureClass: 'terminal_rejection',
        executionCode: 'malformed_request',
        dispatch: 'not_sent',
        providerStatus: null,
        errorName: 'GoogleReviewApiError',
        errorCode: 'provider_unavailable',
      },
      expect.any(String),
    )
    expect(JSON.stringify(deps.logger.error.mock.calls)).not.toContain('quiet')
  })

  // An Archive or Restore committed after the claim: RepKey's own authorizer
  // refuses the write because the Property is no longer active at the cycle's
  // source epoch. Nothing reached Google, so the author must not hear "Google
  // rejected the reply": the cycle is cancelled as a policy cancellation.
  it('cancels a cycle the authorizer refused for a moved Property source as policy', async () => {
    const { deps, handler, gateway, admit, getReview, job } = incidentDeps(
      'ya29.access-token',
      { ok: false, code: 'stale_source' },
    )
    deps.replyCommandStore.cancelPublications.mockResolvedValue(1)

    await expect(handler(job)).resolves.toBeUndefined()

    expect(admit).not.toHaveBeenCalled()
    expect(gateway.execute).not.toHaveBeenCalled()
    expect(getReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledWith([
      {
        reply: expect.objectContaining({
          id: IDS.reply,
          publicationState: 'sending',
          publicationAttempts: 1,
        }),
        event: expect.objectContaining({
          _tag: 'review.reply.publication_cancelled',
          replyId: IDS.reply,
          reviewId: IDS.review,
          propertyId: IDS.property,
          organizationId: ORG,
          cause: 'policy',
          occurredAt: NOW,
        }),
        now: NOW,
      },
    ])
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
  })

  it.each(['authorization_denied', 'runtime_unavailable'] as const)(
    'keeps a %s refusal a terminal rejection',
    async (code) => {
      const { deps, handler, job } = incidentDeps('ya29.access-token', {
        ok: false,
        code,
      })

      await expect(handler(job)).resolves.toBeUndefined()

      expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
      expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
        'terminal_rejection',
      )
    },
  )
})

// Google revoked the grant: the reply PUT is answered 401 and the forced
// refresh is refused for good. Over the REAL executor, 401-refresh wrapper and
// review API adapter (only permit admission, the gateway and the refresh are
// fakes), the reply used to read as an unknown dispatch, stayed "sending" and
// ended on the 72-hour read ladder with "Google rejected the reply".
describe('publish-reply job when Google revoked the grant (real provider adapters)', () => {
  const ORG = '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC'
  const IDS = {
    property: '00000000-0000-4000-8000-00000000b001',
    connection: '00000000-0000-4000-8000-00000000b002',
    review: '00000000-0000-4000-8000-00000000b003',
    reply: '00000000-0000-4000-8000-00000000b004',
  }

  function revokedGrantDeps(authorize: 'authorized' | 'refused' = 'authorized') {
    const deps = makeDeps()
    let current = {
      ...approvedReply,
      id: IDS.reply,
      reviewId: IDS.review,
      organizationId: ORG,
    }
    deps.replyRepo.findById.mockImplementation(async () => current)
    deps.replyCommandStore.markPublicationSending.mockImplementation(async () => {
      if (current.publicationState !== 'authorized') return null
      current = {
        ...current,
        publicationState: 'sending',
        publicationAttempts: current.publicationAttempts + 1,
      }
      return current
    })
    deps.reviewRepo.findById.mockResolvedValue({
      ...review,
      id: IDS.review,
      organizationId: ORG,
      propertyId: IDS.property,
      googleConnectionId: IDS.connection,
    })
    const gateway = {
      execute: vi.fn(async () => ({
        ok: true as const,
        status: 401,
        headers: {
          contentType: 'application/json; charset=utf-8',
          cacheControl: null,
          retryAfter: null,
        },
        body: new TextEncoder().encode('{"error":{"status":"UNAUTHENTICATED"}}'),
      })),
    }
    const refreshAccessToken = vi.fn(async () => {
      throw integrationError(
        'reauthorization_required',
        'Google connection requires reauthorization',
      )
    })
    const executor = createSingle401RefreshExecutor({
      executor: createGoogleAuthorizedProviderExecutor({
        bindCredential: (credential) =>
          createHash('sha256').update(credential, 'utf8').digest('hex'),
        admit: vi.fn(async () => ({ ok: true as const, permitId: 'permit-1' })),
        gateway,
      }),
      refreshAccessToken,
      getAccessToken: async () => 'unused-access-token',
      reauthorize: async ({ authorization }) => authorization,
    })
    const googleReviewApi = createGoogleReviewApiAdapter({
      connectionRepo: { findById: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      cursorStore: {} as never,
      executor,
      authorizeReplyPublicationProviderCall: vi.fn(async (input) => {
        if (authorize === 'refused') {
          throw new Error(
            'Google reply publication authorization is unavailable: runtime_unavailable',
          )
        }
        return {
          accessToken: 'ya29.revoked-access-token',
          authorization: {
            capability: 'property.publish_reply' as const,
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            connectionId: input.connectionId,
            initiatorUserId: null,
            expectedCredentialGeneration: 1,
            authorizationVector: {
              generation: 1,
              propertySourceEpoch: input.sourceEpoch,
              publicationCycle: input.publicationCycle,
              publicationAttemptNumber: input.attemptNumber,
              expectedReplyDigest: googleReplyTextDigest(approvedReply.text),
            },
            publication: {
              reviewId: input.reviewId,
              replyId: input.replyId,
              publicationCycle: input.publicationCycle,
              attemptNumber: input.attemptNumber,
              sourceEpoch: input.sourceEpoch,
              materialReviewRevision: input.materialReviewRevision,
            },
          },
        }
      }),
      nowMs: () => NOW.getTime(),
    })
    const handler = createPublishReplyHandler({
      ...deps,
      googleReviewApi,
      // The refresh use case has moved the connection to reauth_required.
      googleConnectionStatus: { findStatus: async () => 'reauth_required' },
    } as never)
    const job = makeJob(0, {
      ...JOB_DATA,
      replyId: IDS.reply,
      organizationId: ORG,
      propertyId: IDS.property,
    })
    return { deps, handler, gateway, refreshAccessToken, job }
  }

  const expectTerminalWithReconnectCause = (deps: ReturnType<typeof makeDeps>) => {
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply }),
      'terminal_rejection',
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        cause: 'google_reauthorization_required',
      }),
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
  }

  it('ends a reply answered 401 terminal on attempt 1, naming the reconnect remedy', async () => {
    const { deps, handler, gateway, refreshAccessToken, job } = revokedGrantDeps()

    await expect(handler(job)).resolves.toBeUndefined()

    expect(gateway.execute).toHaveBeenCalledOnce()
    expect(refreshAccessToken).toHaveBeenCalledOnce()
    expectTerminalWithReconnectCause(deps)
  })

  it('ends a reply whose publication authority was refused the same way, sending nothing', async () => {
    const { deps, handler, gateway, job } = revokedGrantDeps('refused')

    await expect(handler(job)).resolves.toBeUndefined()

    expect(gateway.execute).not.toHaveBeenCalled()
    expectTerminalWithReconnectCause(deps)
  })
})
