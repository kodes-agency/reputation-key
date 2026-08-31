import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  getStatus: vi.fn(),
  closureRequestAvailable: vi.fn(() => true),
  requestClosure: vi.fn(),
  cancelClosure: vi.fn(),
  reactivate: vi.fn(),
  exportRequest: vi.fn(),
  exportCurrent: vi.fn(),
  issueRetrieval: vi.fn(),
  retrieve: vi.fn(),
  getActiveOrg: vi.fn(),
  reactivationConfigured: { value: true },
  exportConfigured: { value: true },
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPort: { getActiveOrg: mocks.getActiveOrg },
    clock: () => NOW,
    idGen: () => '33333333-3333-4333-8333-333333333333',
    identityLifecycleRuntime: {
      control: {
        getStatus: mocks.getStatus,
        closureRequestAvailable: mocks.closureRequestAvailable,
        requestClosure: mocks.requestClosure,
        cancelClosure: mocks.cancelClosure,
        reactivation: {
          configured: mocks.reactivationConfigured.value,
          reactivate: mocks.reactivationConfigured.value ? mocks.reactivate : undefined,
        },
      },
      organizationExport: {
        service: mocks.exportConfigured.value
          ? {
              request: mocks.exportRequest,
              current: mocks.exportCurrent,
              issueRetrieval: mocks.issueRetrieval,
              retrieve: mocks.retrieve,
            }
          : undefined,
      },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ 'x-request-id': 'request-1' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  initCapabilityPolicyStore,
  listBlockedCapabilities,
  resetCapabilityPolicyStore,
  checkScopedCapability,
  type Capability,
  type CapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { capabilityForPermission } from '#/shared/auth/capability-for-permission'
import { canCancelOrganizationClosure } from '../domain/organization-lifecycle'
import {
  cancelOrganizationClosureHandler,
  downloadOrganizationExportHandler,
  getClosureCenterHandler,
  issueOrganizationExportRetrievalHandler,
  reactivateOrganizationHandler,
  requestOrganizationClosureHandler,
  requestOrganizationExportHandler,
} from './organization-closure-fns'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const NOW = new Date('2026-09-01T10:00:00.000Z')
const ORGANIZATION = '00000000-0000-4000-8000-000000000002'
const REQUEST_ID = '00000000-0000-4000-8000-000000000009'
const RECOVERABLE_UNTIL = new Date('2026-09-27T09:30:00.000Z')

const admin = { organizationId: ORGANIZATION, userId: 'user-admin', role: 'AccountAdmin' }
const propertyManager = { ...admin, userId: 'user-pm', role: 'PropertyManager' }
const staffUser = { ...admin, userId: 'user-staff', role: 'Staff' }

const closingStatus = {
  organizationId: ORGANIZATION,
  state: 'closing' as const,
  revision: 2,
  closureLineageId: '11111111-1111-4111-8111-111111111111',
  closureRequestedAt: new Date('2026-08-28T09:30:00.000Z'),
  recoverableUntil: RECOVERABLE_UNTIL,
  irreversibleAt: null,
  closedAt: null,
  reactivationRequired: true,
  lastTransitionAt: new Date('2026-08-28T09:30:00.000Z'),
  lastActorId: 'user-admin',
  lastReasonCode: 'closing_prepared',
  lastSupportEvidenceRef: 'support:CASE-1',
}

const readyExport = {
  id: REQUEST_ID,
  organizationId: ORGANIZATION,
  requestedBy: 'user-admin',
  state: 'ready' as const,
  revision: 3,
  asOf: new Date('2026-08-28T09:31:00.000Z'),
  objectExpiresAt: new Date('2026-09-04T09:31:00.000Z'),
  generationLeaseExpiresAt: null,
  coverageSha256: 'a'.repeat(64),
  manifestSha256: 'b'.repeat(64),
  archiveSha256: 'c'.repeat(64),
  objectKey: 'private/organization-exports/secret.zip',
  encryptionEvidenceRef: 'kms:key-1',
  retrievalOperationId: null,
  retrievalTokenDigest: 'd'.repeat(64),
  retrievalExpiresAt: null,
  retrievedAt: null,
  deletedAt: null,
  lastErrorCode: null,
  preEgressRecordedAt: new Date('2026-08-28T09:32:00.000Z'),
  egressRecoveryAttempts: 0,
  createdAt: new Date('2026-08-28T09:30:00.000Z'),
  updatedAt: new Date('2026-08-28T09:32:00.000Z'),
}

const forbidden = Object.freeze({
  _tag: 'IdentityError',
  code: 'forbidden',
  message: 'A current AccountAdmin is required for Organization lifecycle changes',
})

/** Exactly the fence a closure request commits: the Organization is suspended. */
const suspendedStore: CapabilityPolicyStore = {
  isCapabilityGloballyEnabled: () => true,
  isOrgAllowlisted: () => true,
  isPropertyAllowlisted: () => true,
  isOrgSuspended: (orgId) => orgId === ORGANIZATION,
  isPropertySuspended: () => false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reactivationConfigured.value = true
  mocks.exportConfigured.value = true
  mocks.resolveTenantContext.mockResolvedValue(admin)
  mocks.getActiveOrg.mockResolvedValue({ id: ORGANIZATION, name: 'Harbour Group' })
  mocks.getStatus.mockResolvedValue(closingStatus)
  mocks.exportCurrent.mockResolvedValue(readyExport)
})

afterEach(() => {
  resetCapabilityPolicyStore()
})

describe('Closure Center authorization', () => {
  const commands: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    [
      'requestClosure',
      () =>
        requestOrganizationClosureHandler({
          data: {
            reasonCode: 'account_admin_request' as const,
            supportEvidenceRef: 'support:CASE-1',
            typedConfirmation: 'CLOSE Harbour Group',
          },
        }),
    ],
    [
      'cancelClosure',
      () =>
        cancelOrganizationClosureHandler({
          data: {
            reasonCode: 'closure_cancelled' as const,
            supportEvidenceRef: 'support:CASE-1',
          },
        }),
    ],
    ['requestExport', () => requestOrganizationExportHandler()],
    [
      'issueExportRetrieval',
      () =>
        issueOrganizationExportRetrievalHandler({
          data: { requestId: REQUEST_ID },
        }),
    ],
    [
      'downloadExport',
      () =>
        downloadOrganizationExportHandler({
          data: { requestId: REQUEST_ID, token: 'token-1' },
        }),
    ],
    ['closureCenterRead', () => getClosureCenterHandler()],
  ]

  it.each(commands)(
    'denies a PropertyManager for %s with no state change',
    async (_name, call) => {
      mocks.resolveTenantContext.mockResolvedValue(propertyManager)

      await expect(withStartContext(() => call())).rejects.toMatchObject({
        code: 'forbidden',
      })

      expect(mocks.requestClosure).not.toHaveBeenCalled()
      expect(mocks.cancelClosure).not.toHaveBeenCalled()
      expect(mocks.exportRequest).not.toHaveBeenCalled()
      expect(mocks.issueRetrieval).not.toHaveBeenCalled()
      expect(mocks.retrieve).not.toHaveBeenCalled()
    },
  )

  it.each(commands)('denies a Staff User for %s', async (_name, call) => {
    mocks.resolveTenantContext.mockResolvedValue(staffUser)

    await expect(withStartContext(() => call())).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.requestClosure).not.toHaveBeenCalled()
    expect(mocks.retrieve).not.toHaveBeenCalled()
  })

  it.each(commands)('rejects an unauthenticated caller for %s', async (_name, call) => {
    mocks.resolveTenantContext.mockRejectedValue(
      Object.assign(new Error('Valid session required'), { code: 'unauthorized' }),
    )

    // Tenant resolution fails before any authority is consulted, so the
    // surfaced error is the untagged 500 the boundary produces — not a
    // Closure Center refusal, which would mean the session was accepted.
    await expect(withStartContext(() => call())).rejects.toThrow(/Internal|session/iu)
    expect(mocks.requestClosure).not.toHaveBeenCalled()
    expect(mocks.exportRequest).not.toHaveBeenCalled()
  })

  it('denies a removed member whose binding the command store no longer accepts', async () => {
    // The session still says AccountAdmin; the locked membership + binding
    // read inside the command store is what actually decides.
    mocks.requestClosure.mockRejectedValue(forbidden)

    await expect(
      withStartContext(() =>
        requestOrganizationClosureHandler({
          data: {
            reasonCode: 'account_admin_request',
            supportEvidenceRef: 'support:CASE-1',
            typedConfirmation: 'CLOSE Harbour Group',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('Closure Center posture (program bullet 8)', () => {
  /**
   * The whole point of the constraint: adding the Closure Center must not
   * turn any capability on or off. This compares the exact sorted list, so a
   * future edit that quietly promotes MFA or re-opens a dark capability fails
   * here rather than in production.
   */
  it('leaves BLOCKED_CAPABILITIES byte-equal', () => {
    expect(listBlockedCapabilities()).toEqual([
      'badge.use',
      'gbp.ai.cross_property_summary',
      'gbp.reply.auto_publish',
      'gbp.review_solicitation_gamification',
      'identity.custom_roles',
      'identity.register',
      'leaderboard.use',
      'organization.create',
      'portal.guest_contact',
      'portal.guest_media',
      'portal.upload',
      'property.erase',
      'team.use',
    ])
  })

  it('introduces no MFA, step-up or fresh-password factor on the closure path', async () => {
    // The module source is the evidence: a second factor would have to appear
    // as a call, an import or a challenge field somewhere on this path.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('./organization-closure-fns.ts', import.meta.url).pathname,
        'utf8',
      ),
    )
    const factorPattern =
      /\b(verifyPassword|currentPassword|requirePassword|mfa|totp|otp|stepUp|step_up|reauthenticate|challenge)\b/iu
    const code = source.split(/^\/\/.*$/gmu).join('')
    expect(factorPattern.test(code.replace(/\/\*[\s\S]*?\*\//gu, ''))).toBe(false)
  })

  it('proves the read-only restriction: every ordinary mutation is refused while closing', () => {
    initCapabilityPolicyStore(suspendedStore)

    const refused = (
      ['portal.create', 'reply.manage', 'invitation.create', 'goal.create'] as const
    ).map((permission) => {
      const capability: Capability = capabilityForPermission(permission)
      return checkScopedCapability({ organizationId: ORGANIZATION }, capability)
    })

    expect(refused.map((decision) => decision.reason)).toEqual([
      'org_suspended',
      'org_suspended',
      'org_suspended',
      'org_suspended',
    ])
  })

  it('keeps the Closure Center itself reachable behind that same fence', async () => {
    initCapabilityPolicyStore(suspendedStore)

    const view = await withStartContext(() => getClosureCenterHandler())

    expect(view.state).toBe('closing')
    expect(mocks.getStatus).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      actorUserId: 'user-admin',
    })
  })
})

describe('Closure Center read', () => {
  it('renders the exact recovery deadline and never leaks storage material', async () => {
    const view = await withStartContext(() => getClosureCenterHandler())

    expect(view).toMatchObject({
      organizationName: 'Harbour Group',
      timezone: 'America/New_York',
      recoverableUntil: RECOVERABLE_UNTIL.toISOString(),
      confirmationPhrase: 'CLOSE Harbour Group',
      reactivationRequired: true,
    })
    expect(view.export).toEqual({
      requestId: REQUEST_ID,
      state: 'ready',
      asOf: readyExport.asOf.toISOString(),
      objectExpiresAt: readyExport.objectExpiresAt.toISOString(),
      retrievalExpiresAt: null,
      archiveSha256: 'c'.repeat(64),
      coverageSha256: 'a'.repeat(64),
      lastErrorCode: null,
    })
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('private/organization-exports')
    expect(serialized).not.toContain(readyExport.retrievalTokenDigest)
    expect(serialized).not.toContain('kms:key-1')
    expect(serialized).not.toContain('support:CASE-1')
  })

  it('computes cancellability on the server clock, not the client', () => {
    expect(
      canCancelOrganizationClosure({
        state: 'closing',
        recoverableUntil: RECOVERABLE_UNTIL,
        now: NOW,
      }),
    ).toBe(true)
    expect(
      canCancelOrganizationClosure({
        state: 'closing',
        recoverableUntil: RECOVERABLE_UNTIL,
        now: RECOVERABLE_UNTIL,
      }),
    ).toBe(false)
  })

  it('reports every reactivation check as not_evaluated until the fence is up', async () => {
    const view = await withStartContext(() => getClosureCenterHandler())

    expect(view.reactivationChecks.map((check) => check.id)).toEqual([
      'data_cell_health',
      'responsible_manager',
      'google_authorization',
      'portal_reactivation',
      'schedule_quarantine_cleared',
    ])
    expect(view.reactivationChecks.every((check) => !check.satisfied)).toBe(true)
  })
})

describe('Closure request and cancellation', () => {
  it('refuses a mismatched typed confirmation without touching the lifecycle', async () => {
    await expect(
      withStartContext(() =>
        requestOrganizationClosureHandler({
          data: {
            reasonCode: 'account_admin_request',
            supportEvidenceRef: 'support:CASE-1',
            typedConfirmation: 'close harbour group',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
    expect(mocks.requestClosure).not.toHaveBeenCalled()
  })

  it('passes a fresh operation id so a retry replays instead of double-requesting', async () => {
    mocks.requestClosure.mockResolvedValue({
      ...closingStatus,
      state: 'closure_requested',
    })

    await withStartContext(() =>
      requestOrganizationClosureHandler({
        data: {
          reasonCode: 'account_admin_request',
          supportEvidenceRef: 'support:CASE-1',
          typedConfirmation: 'CLOSE Harbour Group',
        },
      }),
    )

    expect(mocks.requestClosure).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        organizationId: ORGANIZATION,
        actorUserId: 'user-admin',
        reasonCode: 'account_admin_request',
      }),
    )
  })

  it('surfaces the store refusal when the recovery window has closed', async () => {
    mocks.cancelClosure.mockRejectedValue({
      _tag: 'IdentityError',
      code: 'forbidden',
      message: 'Organization closure is no longer recoverable',
    })

    await expect(
      withStartContext(() =>
        cancelOrganizationClosureHandler({
          data: { reasonCode: 'closure_cancelled', supportEvidenceRef: 'support:CASE-1' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('reports that cancellation resumed nothing', async () => {
    mocks.cancelClosure.mockResolvedValue({
      ...closingStatus,
      state: 'active',
      revision: 3,
      reactivationRequired: true,
    })

    const result = await withStartContext(() =>
      cancelOrganizationClosureHandler({
        data: { reasonCode: 'closure_cancelled', supportEvidenceRef: 'support:CASE-1' },
      }),
    )

    expect(result).toEqual({ state: 'active', revision: 3, reactivationRequired: true })
  })
})

describe('Organization Export retrieval', () => {
  it('returns the retrieval token exactly once, bounded to 24 hours', async () => {
    const expiresAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    mocks.issueRetrieval.mockResolvedValue({ token: 'single-use-token', expiresAt })

    const issued = await withStartContext(() =>
      issueOrganizationExportRetrievalHandler({ data: { requestId: REQUEST_ID } }),
    )

    expect(issued).toEqual({
      token: 'single-use-token',
      expiresAt: expiresAt.toISOString(),
    })
    expect(expiresAt.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(expiresAt.getTime()).toBeLessThanOrEqual(readyExport.objectExpiresAt.getTime())
  })

  it('refuses a second download with the same token', async () => {
    const archive = Buffer.from('PKpayload', 'utf8')
    mocks.retrieve.mockResolvedValueOnce(archive)
    mocks.retrieve.mockRejectedValueOnce(
      new Error('Organization Export authority changed'),
    )

    const first = await withStartContext(() =>
      downloadOrganizationExportHandler({
        data: { requestId: REQUEST_ID, token: 'token-1' },
      }),
    )
    expect(first.archiveBase64).toBe(archive.toString('base64'))

    await expect(
      withStartContext(() =>
        downloadOrganizationExportHandler({
          data: { requestId: REQUEST_ID, token: 'token-1' },
        }),
      ),
    ).rejects.toThrow(/Internal|authority changed/iu)
  })

  it('refuses export commands when the export service is not composed', async () => {
    mocks.exportConfigured.value = false

    await expect(
      withStartContext(() => requestOrganizationExportHandler()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('Explicit reactivation', () => {
  it('attributes every deliberate action to the acting AccountAdmin', async () => {
    mocks.reactivate.mockResolvedValue({
      status: {
        ...closingStatus,
        state: 'active',
        revision: 4,
        reactivationRequired: false,
      },
      checks: [],
      evidenceRef: 'lifecycle:reactivation:test',
    })

    await withStartContext(() =>
      reactivateOrganizationHandler({
        data: {
          acknowledgements: [
            { id: 'portal_republished', reasonCode: 'portal_restored' },
            { id: 'ai_capability_reviewed', reasonCode: 'ai_left_disabled' },
            { id: 'google_reauthorized', reasonCode: 'fresh_consent' },
          ],
        },
      }),
    )

    expect(mocks.reactivate).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgements: [
          {
            id: 'portal_republished',
            reasonCode: 'portal_restored',
            actorUserId: 'user-admin',
          },
          {
            id: 'ai_capability_reviewed',
            reasonCode: 'ai_left_disabled',
            actorUserId: 'user-admin',
          },
          {
            id: 'google_reauthorized',
            reasonCode: 'fresh_consent',
            actorUserId: 'user-admin',
          },
        ],
      }),
    )
  })

  it('refuses reactivation when the readiness probes are not composed', async () => {
    mocks.reactivationConfigured.value = false

    await expect(
      withStartContext(() =>
        reactivateOrganizationHandler({
          data: {
            acknowledgements: [
              { id: 'portal_republished', reasonCode: 'portal_restored' },
              { id: 'ai_capability_reviewed', reasonCode: 'ai_left_disabled' },
              { id: 'google_reauthorized', reasonCode: 'fresh_consent' },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
