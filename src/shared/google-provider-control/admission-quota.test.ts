import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createGoogleExecutionAdmissionService,
  type GoogleAdmissionPermitAuthority,
  type GoogleAdmissionPermitSnapshot,
} from './admission-service'
import { createGoogleEgressGateway } from './egress-gateway'
import {
  createGoogleCoordinationLookup,
  googleQuotaCredentialFingerprint,
} from './quota-coordinator'
import { compileGoogleProviderRequest } from './route-catalogue'
import { createFakeGoogleCoordinationRedis } from '#/shared/testing/fake-google-coordination-redis'

const descriptor = {
  routeKey: 'account-management.accounts.list' as const,
  accessToken: 'access-token',
}
const bindCredential = (credential: string) =>
  createHmac('sha256', 'admission-quota-test-key').update(credential).digest('hex')
const admission = compileGoogleProviderRequest(descriptor, bindCredential).admission
const projectFingerprint = 'd'.repeat(64)

describe('Google admission quota accounting', () => {
  it.each(['changed', 'expired', 'unavailable', 'throw', 'deadline'] as const)(
    'keeps the four-call burst limit after refill, consumption and delayed permit refusal (%s)',
    async (refusal) => {
      let nowMs = 1_000
      let sequence = 0
      const redis = createFakeGoogleCoordinationRedis()
      const coordination = () =>
        createGoogleCoordinationLookup({
          redis,
          nowMs: () => nowMs,
          leaseId: () => `admission-quota-lease-${++sequence}`,
        })
      const entered = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const authority: GoogleAdmissionPermitAuthority = {
        load: async (permitId): Promise<GoogleAdmissionPermitSnapshot> => ({
          permitId,
          kind: 'work',
          routeKey: admission.routeKey,
          routeCatalogueVersion: admission.catalogueVersion,
          expectedAdmission: admission,
          quotaKey: {
            credentialFingerprint: googleQuotaCredentialFingerprint(
              admission.credentialBinding,
              projectFingerprint,
            )!,
            projectFingerprint,
            endpointClass: admission.endpointClass,
            organizationId: 'organization-1',
            initiatorUserId: 'user-1',
            connectionId: 'connection-1',
            propertyId: null,
          },
          expiresAtMs: 20_000,
          authorityRevision: 'authority-revision-1',
        }),
        start: async (permit) => {
          if (permit.permitId !== 'stalled-permit') return 'started'
          entered.resolve()
          await resume.promise
          if (refusal === 'throw') throw new Error('permit authority unavailable')
          return refusal === 'deadline' ? 'started' : refusal
        },
        failStarted: vi.fn(async () => undefined),
        complete: vi.fn(async () => undefined),
      }
      const sentAt: number[] = []
      const fetchProvider = vi.fn<typeof fetch>(async () => {
        sentAt.push(nowMs)
        return new Response('{}')
      })
      const replica = () =>
        createGoogleEgressGateway({
          nowMs: () => nowMs,
          bindCredential,
          fetch: fetchProvider,
          admission: createGoogleExecutionAdmissionService({
            nowMs: () => nowMs,
            authority,
            ...coordination(),
          }),
        })
      const first = replica()
      const other = replica()
      const stalled = first.execute({
        permitId: 'stalled-permit',
        descriptor,
        deadlineMs: refusal === 'deadline' ? 2_000 : 10_000,
      })
      await entered.promise

      // Refill reaches capacity before four other permits consume the entire burst.
      nowMs = 2_000
      for (let index = 0; index < 4; index++) {
        await expect(
          other.execute({
            permitId: `burst-permit-${index}`,
            descriptor,
            deadlineMs: 10_000,
          }),
        ).resolves.toMatchObject({ ok: true })
      }
      resume.resolve()
      await expect(stalled).resolves.toMatchObject({
        ok: false,
        code: 'admission_denied',
        dispatch: 'not_sent',
      })
      await expect(
        other.execute({ permitId: 'fifth-permit', descriptor, deadlineMs: 10_000 }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'admission_denied',
        admissionCode: 'quota_exhausted',
        dispatch: 'not_sent',
        retryAfterMs: 250,
      })
      expect(sentAt).toEqual([2_000, 2_000, 2_000, 2_000])

      nowMs += 250
      await expect(
        other.execute({ permitId: 'refilled-permit', descriptor, deadlineMs: 10_000 }),
      ).resolves.toMatchObject({ ok: true })
      expect(sentAt).toEqual([2_000, 2_000, 2_000, 2_000, 2_250])
    },
  )
})
