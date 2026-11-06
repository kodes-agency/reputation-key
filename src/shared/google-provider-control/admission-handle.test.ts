import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createGoogleExecutionAdmissionService,
  type GoogleAdmissionPermitAuthority,
  type GoogleAdmissionPermitSnapshot,
} from './admission-service'
import type { GoogleInFlightCoordinator, GoogleQuotaCoordinator } from './contracts'
import { googleQuotaCredentialFingerprint } from './quota-coordinator'
import { compileGoogleProviderRequest } from './route-catalogue'

const bindCredential = (credential: string) =>
  createHmac('sha256', 'admission-handle-test-key').update(credential).digest('hex')
const admission = compileGoogleProviderRequest(
  { routeKey: 'account-management.accounts.list', accessToken: 'access-token' },
  bindCredential,
).admission
const projectFingerprint = 'd'.repeat(64)
const credentialFingerprint = googleQuotaCredentialFingerprint(
  admission.credentialBinding,
  projectFingerprint,
)
if (!credentialFingerprint) throw new Error('test credential binding is invalid')

const permit: GoogleAdmissionPermitSnapshot = Object.freeze({
  permitId: 'permit-handle-test',
  kind: 'work',
  routeKey: admission.routeKey,
  routeCatalogueVersion: admission.catalogueVersion,
  expectedAdmission: admission,
  quotaKey: Object.freeze({
    credentialFingerprint,
    projectFingerprint,
    endpointClass: admission.endpointClass,
    organizationId: 'organization-1',
    initiatorUserId: 'user-1',
    connectionId: 'connection-1',
    propertyId: null,
  }),
  expiresAtMs: 20_000,
  authorityRevision: 'authority-revision-1',
})

const completion = Object.freeze({ outcome: 'success' as const, retryAfterMs: null })

function fixture(
  options: Readonly<{
    nowMs?: () => number
    permit?: GoogleAdmissionPermitSnapshot
    acquireInFlight?: GoogleInFlightCoordinator['acquire']
    acquireQuota?: GoogleQuotaCoordinator['acquire']
    startPermit?: GoogleAdmissionPermitAuthority['start']
  }> = {},
) {
  const calls: string[] = []
  const release = vi.fn(async () => true)
  const refund = vi.fn(async () => true)
  const complete = vi.fn<GoogleAdmissionPermitAuthority['complete']>(
    async () => undefined,
  )
  const failStarted = vi.fn<GoogleAdmissionPermitAuthority['failStarted']>(
    async () => undefined,
  )
  const load = vi.fn(async () => options.permit ?? permit)
  const acquireInFlight = vi.fn<GoogleInFlightCoordinator['acquire']>(async (...args) => {
    calls.push('in-flight')
    return options.acquireInFlight
      ? options.acquireInFlight(...args)
      : { ok: true, lease: { leaseId: 'inflight-handle-test', expiresAtMs: 15_000 } }
  })
  const acquireQuota = vi.fn<GoogleQuotaCoordinator['acquire']>(async (...args) => {
    calls.push('quota')
    return options.acquireQuota
      ? options.acquireQuota(...args)
      : { ok: true, remaining: 9 }
  })
  const startPermit = vi.fn<GoogleAdmissionPermitAuthority['start']>(async (...args) => {
    calls.push('permit')
    return options.startPermit ? options.startPermit(...args) : 'started'
  })
  const service = createGoogleExecutionAdmissionService({
    nowMs: options.nowMs ?? (() => 1_000),
    authority: { load, start: startPermit, failStarted, complete },
    quotaForPolicy: () => ({ acquire: acquireQuota, refund }),
    inFlightForPolicy: () => ({ acquire: acquireInFlight, release }),
  })
  const start = () =>
    service.start({ permitId: permit.permitId, admission, deadlineMs: 10_000 })
  return {
    service,
    start,
    calls,
    acquireInFlight,
    acquireQuota,
    startPermit,
    release,
    refund,
    complete,
    failStarted,
  }
}

describe('Google in-process admission handle', () => {
  it('acquires in-flight, then quota, then starts the exact permit', async () => {
    const test = fixture()
    const result = await test.start()

    expect(result.ok).toBe(true)
    expect(test.calls).toEqual(['in-flight', 'quota', 'permit'])
    expect(test.startPermit).toHaveBeenCalledWith(permit)
    expect(test.acquireQuota).toHaveBeenCalledWith(permit.quotaKey, 1, 10_000)
    expect(test.refund).not.toHaveBeenCalled()
    expect(test.release).not.toHaveBeenCalled()
  })

  it('does not spend quota while an in-flight slot is unavailable', async () => {
    const test = fixture({
      acquireInFlight: async () => ({
        ok: false,
        code: 'limit_exhausted',
        retryAfterMs: 500,
      }),
    })

    await expect(test.start()).resolves.toEqual({
      ok: false,
      code: 'in_flight_exhausted',
      retryAfterMs: 500,
    })
    expect(test.acquireQuota).not.toHaveBeenCalled()
    expect(test.startPermit).not.toHaveBeenCalled()
    expect(test.release).not.toHaveBeenCalled()
  })

  it.each(['quota_exhausted', 'coordination_unavailable'] as const)(
    'releases the slot without starting a permit when quota returns %s',
    async (code) => {
      const test = fixture({
        acquireQuota: async () => ({ ok: false, code, retryAfterMs: 100 }),
      })

      await expect(test.start()).resolves.toEqual({ ok: false, code, retryAfterMs: 100 })
      expect(test.startPermit).not.toHaveBeenCalled()
      expect(test.release).toHaveBeenCalledTimes(1)
      expect(test.refund).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['changed', 'authorization_changed'],
    ['expired', 'permit_expired'],
    ['unavailable', 'coordination_unavailable'],
  ] as const)(
    'refunds quota and releases the slot when permit start is %s',
    async (outcome, code) => {
      const test = fixture({ startPermit: async () => outcome })

      await expect(test.start()).resolves.toEqual({ ok: false, code, retryAfterMs: 0 })
      expect(test.refund).toHaveBeenCalledExactlyOnceWith(permit.quotaKey, 1)
      expect(test.release).toHaveBeenCalledTimes(1)
      expect(test.complete).not.toHaveBeenCalled()
    },
  )

  it('rejects a substituted credential before acquiring shared capacity', async () => {
    const test = fixture()

    await expect(
      test.service.start({
        permitId: permit.permitId,
        admission: { ...admission, credentialBinding: 'e'.repeat(64) },
        deadlineMs: 10_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'request_mismatch', retryAfterMs: 0 })
    expect(test.calls).toEqual([])
  })

  it('rejects an expired permit before acquiring shared capacity', async () => {
    const test = fixture({ permit: { ...permit, expiresAtMs: 1_000 } })

    await expect(test.start()).resolves.toEqual({
      ok: false,
      code: 'permit_expired',
      retryAfterMs: 0,
    })
    expect(test.calls).toEqual([])
  })

  it('keeps the exact permit and outcome for a completion retry after authority failure', async () => {
    const test = fixture()
    test.complete.mockRejectedValueOnce(new Error('database unavailable'))
    const started = await test.start()
    if (!started.ok) throw new Error('expected admitted handle')

    await expect(started.handle.complete(completion)).resolves.toBe(false)
    await expect(started.handle.complete(completion)).resolves.toBe(true)
    await expect(started.handle.complete(completion)).resolves.toBe(true)
    expect(test.complete).toHaveBeenCalledTimes(2)
    expect(test.complete).toHaveBeenNthCalledWith(
      1,
      permit.permitId,
      permit.authorityRevision,
      'success',
      null,
    )
    expect(test.complete).toHaveBeenNthCalledWith(
      2,
      permit.permitId,
      permit.authorityRevision,
      'success',
      null,
    )
    expect(test.release).toHaveBeenCalledTimes(1)
  })

  it('retries a failed lease release without repeating successful durable completion', async () => {
    const test = fixture()
    test.release.mockResolvedValueOnce(false)
    const started = await test.start()
    if (!started.ok) throw new Error('expected admitted handle')

    await expect(started.handle.complete(completion)).resolves.toBe(false)
    await expect(started.handle.complete(completion)).resolves.toBe(true)
    expect(test.release).toHaveBeenCalledTimes(2)
    expect(test.complete).toHaveBeenCalledTimes(1)
  })

  it('does not let a conflicting completion race the first outcome', async () => {
    const test = fixture()
    let finish: (() => void) | undefined
    test.complete.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const started = await test.start()
    if (!started.ok) throw new Error('expected admitted handle')
    const first = started.handle.complete(completion)

    await expect(
      started.handle.complete({ outcome: 'transport_error', retryAfterMs: null }),
    ).resolves.toBe(false)
    if (!finish) throw new Error('expected durable completion to have started')
    finish()
    await expect(first).resolves.toBe(true)
    await expect(
      started.handle.complete({ outcome: 'provider_5xx', retryAfterMs: null }),
    ).resolves.toBe(false)
    expect(test.complete).toHaveBeenCalledExactlyOnceWith(
      permit.permitId,
      permit.authorityRevision,
      'success',
      null,
    )
  })
})
