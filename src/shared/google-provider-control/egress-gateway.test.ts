import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  GoogleAdmissionHandle,
  GoogleAdmissionStartResult,
  GoogleExecutionAdmissionService,
} from './admission-service'
import { createGoogleEgressGateway } from './egress-gateway'
import { type GoogleProviderRouteDescriptor } from './route-catalogue'

// Every failure must say whether a request could have reached Google. The reply
// publication workflow may only treat a failed send as safe to repeat on
// positive evidence that `fetch` was never called for that attempt
// (CONTRACT-REPLY D2), so each exit below is pinned to the stage it leaves at.

const bindCredential = (credential: string) =>
  createHmac('sha256', 'credential-binding-test-key').update(credential).digest('hex')
const PERMIT_ID = 'permit-dispatch-01'
const NOW_MS = 1_000
const DEADLINE_MS = 10_000
const DESCRIPTOR: GoogleProviderRouteDescriptor = Object.freeze({
  routeKey: 'account-management.accounts.list',
  accessToken: 'provider-access-token',
})

type AdmissionStub = GoogleExecutionAdmissionService &
  Pick<GoogleAdmissionHandle, 'complete'>

function harness(
  input: Readonly<{
    start?: AdmissionStub['start']
    complete?: AdmissionStub['complete']
    fetch?: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    nowMs?: () => number
  }> = {},
) {
  const fetchMock = vi.fn(
    input.fetch ??
      (async () =>
        new Response('{"accounts":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
  )
  const complete = vi.fn(input.complete ?? (async () => true))
  const warn = vi.fn()
  const admission: AdmissionStub = {
    start:
      input.start ??
      (async (): Promise<GoogleAdmissionStartResult> => ({
        ok: true,
        handle: { expiresAtMs: 20_000, complete },
      })),
    complete,
  }
  const gateway = createGoogleEgressGateway({
    nowMs: input.nowMs ?? (() => NOW_MS),
    bindCredential,
    admission,
    fetch: fetchMock as unknown as typeof fetch,
    logger: { warn },
  })
  return { gateway, fetchMock, complete, warn }
}

const execute = (
  gateway: ReturnType<typeof harness>['gateway'],
  overrides: Readonly<{
    permitId?: string
    descriptor?: GoogleProviderRouteDescriptor
  }> = {},
) =>
  gateway.execute({
    permitId: overrides.permitId ?? PERMIT_ID,
    descriptor: overrides.descriptor ?? DESCRIPTOR,
    deadlineMs: DEADLINE_MS,
  })

describe('Google egress gateway dispatch evidence: nothing was sent', () => {
  it('reports not_sent for a malformed gateway request', async () => {
    const { gateway, fetchMock } = harness()

    await expect(execute(gateway, { permitId: 'permit with spaces' })).resolves.toEqual({
      ok: false,
      code: 'malformed_request',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // An elapsed deadline is time, not a malformed request: the reply workflow
  // treats `malformed_request` as a deterministic refusal and stops retrying
  // (reply-publication-workflow.ts classifyByDispatch), so a slow permit
  // issuance must not arrive here wearing that code.
  it.each([
    ['at', DEADLINE_MS],
    ['past', DEADLINE_MS + 1],
  ])(
    'reports deadline_exceeded, not_sent, when the gateway is entered %s its deadline',
    async (_label, nowMs) => {
      const start = vi.fn(async (): Promise<GoogleAdmissionStartResult> => {
        throw new Error('admission must not be asked after the deadline')
      })
      const { gateway, fetchMock } = harness({ nowMs: () => nowMs, start })

      await expect(execute(gateway)).resolves.toEqual({
        ok: false,
        code: 'deadline_exceeded',
        dispatch: 'not_sent',
        retryAfterMs: 0,
      })
      expect(start).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('keeps malformed_request for a deadline beyond the gateway window', async () => {
    const { gateway, fetchMock } = harness({ nowMs: () => DEADLINE_MS - 60_001 })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'malformed_request',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_sent when the descriptor does not compile', async () => {
    const { gateway, fetchMock } = harness()

    await expect(
      execute(gateway, {
        descriptor: { routeKey: 'account-management.accounts.list', accessToken: '' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'malformed_request',
      dispatch: 'not_sent',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_sent when the admission call itself throws', async () => {
    const { gateway, fetchMock } = harness({
      start: async () => {
        throw new Error('admission hop unavailable')
      },
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'coordination_unavailable',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_sent when admission denies the permit', async () => {
    const { gateway, fetchMock } = harness({
      start: async () => ({ ok: false, code: 'quota_exhausted', retryAfterMs: 7_000 }),
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'quota_exhausted',
      dispatch: 'not_sent',
      retryAfterMs: 7_000,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_sent when admission rejects a different request binding', async () => {
    const { gateway, fetchMock } = harness({
      start: async () => ({ ok: false, code: 'request_mismatch', retryAfterMs: 0 }),
    })
    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'request_mismatch',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not dispatch an expired admission handle and still completes bookkeeping', async () => {
    const complete = vi.fn(async () => true)
    const { gateway, fetchMock } = harness({
      start: async () => ({ ok: true, handle: { expiresAtMs: NOW_MS, complete } }),
    })
    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'deadline_exceeded',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith({
      outcome: 'deadline_exceeded',
      retryAfterMs: null,
    })
  })

  it('allows an admitted request to finish after admission expiry within its call deadline', async () => {
    const complete = vi.fn(async () => true)
    const { gateway } = harness({
      start: async () => ({ ok: true, handle: { expiresAtMs: NOW_MS + 1, complete } }),
      fetch: async (_url, init) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        init?.signal?.throwIfAborted()
        return new Response('finished', { status: 200 })
      },
    })
    await expect(execute(gateway)).resolves.toMatchObject({ ok: true, status: 200 })
  })

  it('reports not_sent when the deadline elapses before fetch', async () => {
    // The admission timing read observes that the deadline has elapsed.
    const readings = [NOW_MS, DEADLINE_MS]
    const { gateway, fetchMock } = harness({
      nowMs: () => readings.shift() ?? DEADLINE_MS,
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'deadline_exceeded',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Google egress gateway dispatch evidence: a request left', () => {
  it('reports unknown when fetch throws', async () => {
    const { gateway, fetchMock } = harness({
      fetch: async () => {
        throw new TypeError('socket hang up')
      },
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'transport_error',
      dispatch: 'unknown',
      retryAfterMs: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports answered with the provider status for a 404', async () => {
    const { gateway } = harness({
      fetch: async () =>
        new Response('{"error":{}}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    })

    // A non-2xx answer is still a provider response, so it stays `ok: true`
    // for the callers that already classify status; completing it must not
    // invent a failure.
    await expect(execute(gateway)).resolves.toMatchObject({ ok: true, status: 404 })
  })

  it('reports answered with the provider status for an oversized response', async () => {
    const { gateway } = harness({
      fetch: async () =>
        new Response('x', {
          status: 502,
          headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
        }),
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'response_too_large',
      dispatch: 'answered',
      providerStatus: 502,
      retryAfterMs: 0,
    })
  })

  // The headers arrived, so Google answered; the body then failed. That is a
  // transport fault (or the deadline), not an oversized response, and the permit
  // must record it as the fault it was. Reporting it as `response_too_large`
  // reached the Performance panel as "returned data that could not be safely
  // displayed", a non-retryable state, for a plain connection reset.
  describe('when the response body cannot be read to its end', () => {
    const resetAfterOneChunk = (onFail: () => void = () => undefined) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"accounts":['))
          },
          pull() {
            onFail()
            throw new Error('socket hang up')
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    it('reports a connection reset as a transport error, keeping the answered evidence', async () => {
      const { gateway, complete } = harness({ fetch: async () => resetAfterOneChunk() })

      await expect(execute(gateway)).resolves.toEqual({
        ok: false,
        code: 'transport_error',
        dispatch: 'answered',
        providerStatus: 200,
        retryAfterMs: 0,
      })
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'transport_error' }),
      )
    })

    it('reports a deadline that elapsed mid-body as deadline_exceeded', async () => {
      let nowMs = NOW_MS
      const { gateway, complete } = harness({
        nowMs: () => nowMs,
        fetch: async () =>
          resetAfterOneChunk(() => {
            nowMs = DEADLINE_MS
          }),
      })

      await expect(execute(gateway)).resolves.toEqual({
        ok: false,
        code: 'deadline_exceeded',
        dispatch: 'answered',
        providerStatus: 200,
        retryAfterMs: 0,
      })
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'deadline_exceeded' }),
      )
    })

    it('still reports a streamed body past the byte limit as response_too_large', async () => {
      const { gateway, complete } = harness({
        fetch: async () =>
          new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      })

      await expect(execute(gateway)).resolves.toMatchObject({
        ok: false,
        code: 'response_too_large',
        dispatch: 'answered',
        providerStatus: 200,
      })
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'response_too_large' }),
      )
    })
  })

  it('keeps the provider response when completion fails after a 404', async () => {
    const { gateway, complete, warn } = harness({
      fetch: async () => new Response('{}', { status: 404 }),
      complete: async () => false,
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: true,
      status: 404,
      headers: {
        contentType: 'text/plain;charset=UTF-8',
        cacheControl: null,
        retryAfter: null,
      },
      body: new TextEncoder().encode('{}'),
    })
    expect(complete).toHaveBeenCalledTimes(3)
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'provider_4xx' }),
    )
    // The admission service refused the completion without throwing, so the
    // record names the hop and the evidence but carries no error.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      {
        surface: 'google-egress-gateway',
        stage: 'admission-complete',
        routeKey: DESCRIPTOR.routeKey,
        outcome: 'provider_4xx',
        dispatch: 'answered',
        providerStatus: 404,
      },
      'Google admission completion failed',
    )
  })

  it('keeps unknown when completion throws after fetch threw', async () => {
    const { gateway, warn } = harness({
      fetch: async () => {
        throw new TypeError('connection reset')
      },
      complete: async () => {
        throw new Error('completion hop unavailable')
      },
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'transport_error',
      dispatch: 'unknown',
      retryAfterMs: 0,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      {
        surface: 'google-egress-gateway',
        stage: 'admission-complete',
        routeKey: DESCRIPTOR.routeKey,
        outcome: 'transport_error',
        dispatch: 'unknown',
        err: { name: 'Error' },
      },
      'Google admission completion failed',
    )
  })

  it.each([200, 429, 503])(
    'preserves status %i, headers and body when bookkeeping keeps failing',
    async (status) => {
      const { gateway, fetchMock, complete, warn } = harness({
        fetch: async () =>
          new Response('provider answer', {
            status,
            headers: {
              'content-type': 'application/json',
              'retry-after': '30',
              'cache-control': 'no-store',
            },
          }),
        complete: async () => false,
      })
      await expect(execute(gateway)).resolves.toEqual({
        ok: true,
        status,
        headers: {
          contentType: 'application/json',
          retryAfter: '30',
          cacheControl: 'no-store',
        },
        body: new TextEncoder().encode('provider answer'),
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(complete).toHaveBeenCalledTimes(3)
      expect(warn).toHaveBeenCalledTimes(1)
    },
  )

  it('retries only bookkeeping when completion fails transiently', async () => {
    const complete = vi
      .fn<AdmissionStub['complete']>()
      .mockRejectedValueOnce(new Error('completion unavailable'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const fixture = harness({ complete })
    await expect(execute(fixture.gateway)).resolves.toMatchObject({
      ok: true,
      status: 200,
    })
    expect(fixture.fetchMock).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(3)
    expect(fixture.warn).not.toHaveBeenCalled()
  })

  // On 2026-10-23 two token refreshes were refused with 9 and 12 seconds gone,
  // and nothing said whether the time went before the gateway or inside
  // admission (#946). Each refusal now carries both.
  it('logs the deadline left on entry and the time admission took when it refuses', async () => {
    let nowMs = NOW_MS
    const { gateway, warn } = harness({
      nowMs: () => nowMs,
      start: async () => {
        nowMs = 9_500
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      },
    })

    await expect(execute(gateway)).resolves.toMatchObject({
      code: 'admission_denied',
      admissionCode: 'deadline_exceeded',
    })
    expect(warn).toHaveBeenCalledWith(
      {
        surface: 'google-egress-gateway',
        stage: 'admission-start',
        code: 'deadline_exceeded',
        routeKey: DESCRIPTOR.routeKey,
        retryAfterMs: 0,
        deadlineLeftMs: DEADLINE_MS - NOW_MS,
        admissionMs: 9_500 - NOW_MS,
      },
      'Google admission denied',
    )
  })

  it('logs the same timings when the admission call throws', async () => {
    let nowMs = NOW_MS
    const { gateway, warn } = harness({
      nowMs: () => nowMs,
      start: async () => {
        nowMs = 3_000
        throw new Error('admission hop unavailable')
      },
    })

    await execute(gateway)
    expect(warn).toHaveBeenCalledWith(
      {
        surface: 'google-egress-gateway',
        stage: 'admission-start',
        code: 'coordination_unavailable',
        routeKey: DESCRIPTOR.routeKey,
        deadlineLeftMs: DEADLINE_MS - NOW_MS,
        admissionMs: 3_000 - NOW_MS,
        err: { name: 'Error' },
      },
      'Google admission call failed',
    )
  })

  it('records nothing when the admission completes after the call', async () => {
    const { gateway, complete, warn } = harness()

    await expect(execute(gateway)).resolves.toMatchObject({ ok: true, status: 200 })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
    expect(warn).not.toHaveBeenCalled()
  })
})
