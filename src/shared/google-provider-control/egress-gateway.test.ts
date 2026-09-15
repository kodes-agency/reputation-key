import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { signGoogleAdmissionGrant } from './admission-grant-store'
import type {
  GoogleAdmissionRedeemResult,
  GoogleAdmissionStartResult,
  GoogleExecutionAdmissionService,
} from './admission-service'
import { createGoogleEgressGateway } from './egress-gateway'
import {
  compileGoogleProviderRequest,
  type GoogleProviderRouteDescriptor,
} from './route-catalogue'

// Every failure must say whether a request could have reached Google. The reply
// publication workflow may only treat a failed send as safe to repeat on
// positive evidence that `fetch` was never called for that attempt
// (CONTRACT-REPLY D2), so each exit below is pinned to the stage it leaves at.

const grantKeyring = createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
const bindCredential = (credential: string) =>
  createHmac('sha256', 'credential-binding-test-key').update(credential).digest('hex')
const GATEWAY_IDENTITY = 'google-egress-runtime-1'
const PERMIT_ID = 'permit-dispatch-01'
const NOW_MS = 1_000
const DEADLINE_MS = 10_000
const DESCRIPTOR: GoogleProviderRouteDescriptor = Object.freeze({
  routeKey: 'account-management.accounts.list',
  accessToken: 'provider-access-token',
})

function signedGrant(overrides: Readonly<{ permitId?: string }> = {}) {
  const compiled = compileGoogleProviderRequest(DESCRIPTOR, bindCredential)
  return signGoogleAdmissionGrant(
    {
      admissionId: 'admission-dispatch-0001',
      permitId: overrides.permitId ?? PERMIT_ID,
      routeKey: compiled.routeKey,
      routeCatalogueVersion: compiled.catalogueVersion,
      gatewayIdentity: GATEWAY_IDENTITY,
      requestBindingSha256: compiled.admission.requestBindingSha256,
      credentialBinding: compiled.admission.credentialBinding,
      expiresAtMs: 20_000,
    },
    grantKeyring,
  )
}

type AdmissionStub = Pick<
  GoogleExecutionAdmissionService,
  'start' | 'redeem' | 'complete'
>

function harness(
  input: Readonly<{
    start?: AdmissionStub['start']
    redeem?: AdmissionStub['redeem']
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
  const admission: AdmissionStub = {
    start:
      input.start ??
      (async (): Promise<GoogleAdmissionStartResult> => ({
        ok: true,
        grant: signedGrant(),
      })),
    redeem:
      input.redeem ?? (async (): Promise<GoogleAdmissionRedeemResult> => ({ ok: true })),
    complete,
  }
  const gateway = createGoogleEgressGateway({
    nowMs: input.nowMs ?? (() => NOW_MS),
    gatewayIdentity: GATEWAY_IDENTITY,
    bindCredential,
    grantKeyring,
    admission,
    fetch: fetchMock as unknown as typeof fetch,
  })
  return { gateway, fetchMock, complete }
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

  it('reports not_sent when the signed grant does not match this request', async () => {
    const { gateway, fetchMock } = harness({
      start: async () => ({
        ok: true,
        grant: signedGrant({ permitId: 'permit-someone-else' }),
      }),
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'admission_mismatch',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [
      'refuses',
      async (): Promise<GoogleAdmissionRedeemResult> => ({
        ok: false,
        code: 'grant_replayed',
      }),
    ],
    [
      'throws',
      async (): Promise<GoogleAdmissionRedeemResult> => {
        throw new Error('redeem hop unavailable')
      },
    ],
  ] as const)('reports not_sent when grant redemption %s', async (_label, redeem) => {
    const { gateway, fetchMock } = harness({ redeem })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'admission_mismatch',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_sent when the deadline elapses before fetch', async () => {
    // Validation and grant checks read a time inside the deadline; the
    // pre-fetch read finds it already gone.
    const readings = [NOW_MS, NOW_MS, DEADLINE_MS]
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

  it('keeps answered and the status when completion fails after a 404', async () => {
    const { gateway, complete } = harness({
      fetch: async () => new Response('{}', { status: 404 }),
      complete: async () => false,
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      dispatch: 'answered',
      providerStatus: 404,
      retryAfterMs: 0,
    })
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'provider_4xx' }),
    )
  })

  it('keeps unknown when completion throws after fetch threw', async () => {
    const { gateway } = harness({
      fetch: async () => {
        throw new TypeError('connection reset')
      },
      complete: async () => {
        throw new Error('completion hop unavailable')
      },
    })

    await expect(execute(gateway)).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      dispatch: 'unknown',
      retryAfterMs: 0,
    })
  })
})
