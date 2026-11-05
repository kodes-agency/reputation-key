// The addresses already out in the world: printed on QR codes and NFC tags,
// registered with Google, Pub/Sub and Resend, and linked from published pages.
// A failure here means an issued address would stop working or change what it
// does, so the fix is a way for the old address to keep working, not an edit to
// the expectation.

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  type AnyRoute,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortalTokenCodec } from '#/contexts/portal/infrastructure/adapters/portal-token-codec'
import { signSvixPayload } from '#/shared/auth/svix-signature.verifier'
import { answerPrintHost, printHostPolicy } from '#/shared/security/print-host-redirect'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { Route as portal } from './p/$token'
import { Route as click } from './api/public/p/$token/click/$linkId'
import { Route as media } from './api/public/portal-media/$assetId'
import { Route as google } from './api/auth/google/callback'
import { Route as pubsub } from './api/webhooks/gbp/notifications'
import { Route as resend } from './api/webhooks/resend/events'

const mocks = vi.hoisted(() => ({
  readPage: vi.fn(),
  resolveLink: vi.fn(),
  serveMedia: vi.fn(),
  redeemState: vi.fn(),
  connect: vi.fn(),
  verifyPush: vi.fn(),
  acceptPush: vi.fn(),
  acceptResend: vi.fn(),
}))

// A unit run has no generated-tree initialization. Mount the paths declared by
// the real file routes on the real router; keep their options and handlers intact.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    createFileRoute: (path: string) => (options: object) =>
      actual.createRoute({
        ...options,
        path,
        getParentRoute: () => actual.createRootRoute(),
      }),
  }
})
vi.mock('#/contexts/guest/server/guest-scans', () => ({
  getPublicPortal: mocks.readPage,
  recordScanFn: vi.fn(),
  resolvePublicPortalLink: mocks.resolveLink,
}))
vi.mock('./p/-unavailable-copy', () => ({ loadUnavailableCopy: async () => null }))
vi.mock('#/contexts/guest/server/public', () => ({
  correctGuestResponseFn: vi.fn(),
  selectSecondaryLinkFn: vi.fn(),
  selectGoogleReviewFn: vi.fn(),
  startNewGuestResponseFn: vi.fn(),
  submitPrivateFeedbackFn: vi.fn(),
  submitGuestResponseFn: vi.fn(),
  withdrawPrivateFeedbackFn: vi.fn(),
  withdrawGuestResponseFn: vi.fn(),
}))
vi.mock('#/components/features/guest', () => ({
  ImmersivePublicPortal: () => null,
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: (_name: string, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: vi.fn(),
}))
vi.mock('#/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/shared/config/env')>()
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BETTER_AUTH_URL: 'https://app.example.test',
      GBP_PUBSUB_AUDIENCE: 'https://app.example.test/api/webhooks/gbp/notifications',
      GBP_PUBSUB_TOPIC: 'projects/example/topics/reviews',
      GBP_PUBSUB_PUSH_SERVICE_ACCOUNT: 'push@example.iam.gserviceaccount.com',
      RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from('issued-url-test-key').toString('base64')}`,
    }),
  }
})
vi.mock('#/shared/auth/middleware', () => ({
  getSessionFromHeaders: async () => ({ session: { id: 'session-1' } }),
  resolveTenantContext: async () => ({ organizationId: 'org-1', userId: 'user-1' }),
}))
vi.mock('#/shared/auth/pubsub-jwt.verifier', () => ({
  verifyPubSubJwt: mocks.verifyPush,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    integrationPublicApi: {
      oauth: {
        admitPreState: async () => ({ ok: true }),
        admitResolvedTenant: async () => ({ ok: true }),
        redeemState: mocks.redeemState,
      },
      connections: { connect: mocks.connect },
    },
    integrationWebhookRuntime: { handleNotification: mocks.acceptPush },
    handleResendEvent: mocks.acceptResend,
    portalPublicApi: { portal: { servePortalMedia: mocks.serveMedia } },
    logger: { error: vi.fn() },
  }),
}))

const APP = 'https://app.example.test'
const PRINT = 'https://ap.up.railway.app'
const LONG = 'pt_AQEBAQEBAQEBAQEB_AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI'
const QR = 'S9KT3STHPDN6NJPAH2Y8'
const NFC = 'SPNP0H032WX058TW4G50'
const ARTIFACT = '0b6f1d52-7c3e-4a8e-9f1d-2a4c6e8f0a11'
const LINK = 'b14e46c1-11b6-4e42-942b-9ce031c92a9a'
const codec = createPortalTokenCodec({
  secret: 'print-code-test-secret-0123456789',
  randomBytes: Buffer.alloc,
})
const root = createRootRoute()
const routes: AnyRoute[] = [portal, click, media, google, pubsub, resend]
for (const route of routes) route.options.getParentRoute = () => root
const router = createRouter({
  routeTree: root.addChildren(routes),
  history: createMemoryHistory(),
})

function match(url: string, expected: AnyRoute) {
  const [, params, route] = router.getMatchedRoutes(new URL(url).pathname)
  expect(route).toBe(expected)
  return params
}

function tokenOf(params: Record<string, string>): string {
  const token = params.token
  if (token === undefined) throw new Error('the matched route read no token')
  return token
}

type Handler = (input: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>

type PageLoader = (input: {
  context: { queryClient: QueryClient }
  params: { token: string }
  deps: { locale: string | undefined }
}) => Promise<unknown>

function loadPage(token: string, locale?: string): Promise<unknown> {
  return (portal.options.loader as unknown as PageLoader)({
    context: { queryClient: new QueryClient() },
    params: { token },
    deps: { locale },
  })
}

async function dispatch(route: AnyRoute, request: Request): Promise<Response> {
  const params = match(request.url, route)
  const handlers = route.options.server?.handlers as Record<string, Handler>
  const handler = handlers[request.method]
  expect(handler).toBeTypeOf('function')
  return handler!({ request, params })
}

describe('issued URL contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [
      LONG,
      {
        kind: 'long',
        tokenIdentifier: 'AQEBAQEBAQEBAQEB',
        tokenKeyVersion: 1,
        tokenHash: '75ac1ad819c920c34cf625254dd75d9de73720644bf3808e1ac7ee183645cfa3',
      },
    ],
    [
      QR,
      {
        kind: 'short',
        printCodeHash: 'a6a6241ba485a80d5a5a088f58258deefd19135e4f7eba398743c08b9d595419',
      },
    ],
    [
      NFC,
      {
        kind: 'short',
        printCodeHash: 'ffa210b5a88b5cfcbda468e327f0aa9ea9e46395030040956657550a2c733a5d',
      },
    ],
  ])('reads the issued /p/%s credential without changing its lookup', (token, digest) => {
    const params = match(`${APP}/p/${token}`, portal)
    expect(params).toEqual({ token })
    expect(codec.digest(tokenOf(params))).toEqual(digest)
  })

  it.each([
    [
      QR.toLowerCase(),
      'a6a6241ba485a80d5a5a088f58258deefd19135e4f7eba398743c08b9d595419',
    ],
    [
      NFC.toLowerCase(),
      'ffa210b5a88b5cfcbda468e327f0aa9ea9e46395030040956657550a2c733a5d',
    ],
    [
      'spnpOhO32wxO58tw4g5O',
      'ffa210b5a88b5cfcbda468e327f0aa9ea9e46395030040956657550a2c733a5d',
    ],
  ])('reads a scanner or typed short-code variant: %s', (token, printCodeHash) => {
    const params = match(`${APP}/p/${token}`, portal)
    expect(codec.digest(tokenOf(params))).toEqual({ kind: 'short', printCodeHash })
  })

  it.each([`${QR}X`, QR.slice(1), `U${QR.slice(1)}`, 'pt_bad_secret'])(
    'does not turn a malformed credential into an issued address: %s',
    (token) => {
      const params = match(`${APP}/p/${token}`, portal)
      expect(codec.digest(tokenOf(params))).toBeNull()
    },
  )

  it('keeps the QR/NFC marker and language, tolerating absent or malformed search values', () => {
    const search = (input: Record<string, unknown>) =>
      router.matchRoutes(`/p/${QR}`, input).at(-1)?.search
    expect(search({ accessArtifact: ARTIFACT, locale: 'de' })).toEqual({
      accessArtifact: ARTIFACT,
      locale: 'de',
    })
    expect(search({})).toEqual({})
    expect(search({ accessArtifact: 'old-marker', locale: 'unknown' })).toEqual({})
  })

  it.each([LONG, QR, NFC])(
    'hands the issued credential and language to the page read as printed: %s',
    async (token) => {
      mocks.readPage.mockResolvedValue({ immersive: null })
      await loadPage(token, 'de')
      expect(mocks.readPage).toHaveBeenCalledWith({ data: { token, locale: 'de' } })
    },
  )

  it.each([403, 404, 410])(
    'shows the one unavailable page when the page read is refused with %s',
    async (status) => {
      mocks.readPage.mockRejectedValue(Object.assign(new Error('refused'), { status }))
      await expect(loadPage(LONG)).resolves.toBeNull()
    },
  )

  it('does not hide a failed page read behind the unavailable page', async () => {
    mocks.readPage.mockRejectedValue(
      Object.assign(new Error('read failed'), { status: 500 }),
    )
    await expect(loadPage(LONG)).rejects.toThrow('read failed')
  })

  it.each(['GET', 'HEAD'])(
    '%s on the printed short host preserves path and query',
    (method) => {
      const policy = printHostPolicy(PRINT, APP)
      expect(policy).not.toBeNull()
      for (const token of [LONG, QR, NFC]) {
        const path = `/p/${token}?accessArtifact=${ARTIFACT}&locale=de`
        const response = answerPrintHost(policy!, {
          method,
          url: `${PRINT}${path}`,
          hostHeader: null,
          forwardedHost: null,
        })
        expect(response?.status).toBe(302)
        expect(response?.headers.get('location')).toBe(`${APP}${path}`)
        expect(response?.headers.get('cache-control')).toBe('no-store')
        expect(response?.headers.get('referrer-policy')).toBe('no-referrer')
        expect(match(response!.headers.get('location')!, portal)).toEqual({ token })
      }
    },
  )

  it.each([LONG, QR, NFC])(
    'GET click keeps the token and link identifier: %s',
    async (token) => {
      mocks.resolveLink.mockResolvedValue({
        url: 'https://reviews.example.com/r',
      })
      const response = await dispatch(
        click,
        new Request(`${APP}/api/public/p/${token}/click/${LINK}`),
      )
      expect(mocks.resolveLink).toHaveBeenCalledWith({ data: { token, linkId: LINK } })
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('https://reviews.example.com/r')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    },
  )

  it('GET public media passes the stable asset id and cache validator to its reader', async () => {
    mocks.serveMedia.mockResolvedValue({ kind: 'not_modified', etag: '"image-1"' })
    const response = await dispatch(
      media,
      new Request(`${APP}/api/public/portal-media/${ARTIFACT}`, {
        headers: { 'if-none-match': '"image-1"' },
      }),
    )
    expect(mocks.serveMedia).toHaveBeenCalledWith({
      assetId: ARTIFACT,
      ifNoneMatch: '"image-1"',
    })
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"image-1"')
  })

  it('GET Google callback reads opaque state and provider code and returns to import', async () => {
    mocks.redeemState.mockResolvedValue({
      ok: true,
      kind: 'exchange',
      exchangeAttemptId: ARTIFACT,
      visibility: 'private',
      purpose: 'import_gbp_v2',
      connectionMode: 'new',
      targetConnectionId: null,
      returnRoute: '/properties/import-google',
      verifierMaterial: {
        contractVersion: 'v2',
        codeVerifier: 'v'.repeat(43),
        oidcNonce: 'n'.repeat(43),
      },
    })
    mocks.connect.mockResolvedValue({ id: 'connection-1' })
    const response = await dispatch(
      google,
      new Request(`${APP}/api/auth/google/callback?state=v2.handle&code=provider%2Bcode`),
    )
    expect(mocks.redeemState).toHaveBeenCalledWith({
      handle: 'v2.handle',
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 'session-1',
      nowMs: expect.any(Number),
    })
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'provider+code' }),
      { organizationId: 'org-1', userId: 'user-1' },
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `${APP}/properties/import-google?connectionId=connection-1`,
    )
  })

  it.each(['messageId', 'message_id'])(
    'POST Pub/Sub reads the push envelope with %s',
    async (idKey) => {
      mocks.verifyPush.mockResolvedValue({
        emailVerified: true,
        email: 'push@example.iam.gserviceaccount.com',
      })
      mocks.acceptPush.mockResolvedValue({ duplicate: false, handoff: 'accepted' })
      const response = await dispatch(
        pubsub,
        new Request(`${APP}/api/webhooks/gbp/notifications`, {
          method: 'POST',
          headers: { Authorization: 'Bearer push-token' },
          body: JSON.stringify({
            message: {
              [idKey]: 'push-1',
              data: Buffer.from(
                JSON.stringify({
                  type: 'NEW_REVIEW',
                  location: GOOGLE_LOCATION_PRIMARY_RESOURCE,
                  review: GOOGLE_REVIEW_PRIMARY_RESOURCE,
                }),
              ).toString('base64'),
            },
          }),
        }),
      )
      expect(mocks.verifyPush).toHaveBeenCalledWith(
        'push-token',
        `${APP}/api/webhooks/gbp/notifications`,
      )
      expect(mocks.acceptPush).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'push-1',
          notificationKind: 'NEW_REVIEW',
          locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
          reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
        }),
      )
      expect(response.status).toBe(200)
    },
  )

  it('POST Resend verifies the signed body and reads provider event identifiers', async () => {
    const rawBody = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-10-01T12:00:00.000Z',
      data: { email_id: 'email-1' },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = signSvixPayload({
      id: 'event-1',
      timestamp,
      rawBody,
      signingSecret: `whsec_${Buffer.from('issued-url-test-key').toString('base64')}`,
    })
    mocks.acceptResend.mockResolvedValue({ applied: true, rows: 1, suppressed: 0 })
    const response = await dispatch(
      resend,
      new Request(`${APP}/api/webhooks/resend/events`, {
        method: 'POST',
        headers: {
          'svix-id': 'event-1',
          'svix-timestamp': timestamp,
          'svix-signature': signature,
        },
        body: rawBody,
      }),
    )
    expect(mocks.acceptResend).toHaveBeenCalledWith({
      type: 'email.delivered',
      providerMessageId: 'email-1',
      eventId: 'event-1',
      occurredAt: new Date('2026-10-01T12:00:00.000Z'),
    })
    expect(response.status).toBe(200)
  })
})
