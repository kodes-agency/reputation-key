import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contactRequestLifecycle } from './contact-request-lifecycle'
import type { ContactRequestRepository } from '../ports/contact-request.repository'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, userId } from '#/shared/domain/ids'

const NOW = new Date('2026-08-26T09:00:00.000Z')
const SCOPE = Object.freeze({
  organizationId: '10000000-0000-4000-8000-000000000001',
  propertyId: '10000000-0000-4000-8000-000000000002',
  portalId: '10000000-0000-4000-8000-000000000003',
})
const AUTHORITY = Object.freeze({
  signedSession: 'signed-session-cookie',
  csrfNonce: '10000000-0000-4000-8000-000000000006',
})
const MANAGER_CTX = buildTestAuthContext({
  organizationId: organizationId(SCOPE.organizationId),
  userId: userId('manager-1'),
})

const repository = (): ContactRequestRepository => ({
  create: vi.fn().mockResolvedValue({ outcome: 'created' }),
  findMasked: vi.fn().mockResolvedValue(null),
  reveal: vi.fn().mockResolvedValue({ outcome: 'not_found' }),
  withdraw: vi.fn().mockResolvedValue({ outcome: 'not_found' }),
  purgeExpired: vi.fn().mockResolvedValue({
    processed: 0,
    checkpoint: null,
    completedThrough: NOW,
  }),
})

describe('Contact Request lifecycle', () => {
  let repo: ContactRequestRepository

  const buildLifecycle = (
    overrides: Partial<Parameters<typeof contactRequestLifecycle>[0]> = {},
  ) =>
    contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => '10000000-0000-4000-8000-000000000004',
      revealAuditIdGen: () => '10000000-0000-4000-8000-000000000099',
      policy: {
        decide: vi.fn().mockResolvedValue({ allowed: true, reason: 'allowed' }),
      },
      managerAuthority: {
        resolve: vi.fn().mockResolvedValue('portal_creator'),
      },
      responseAuthority: { authorize: vi.fn().mockResolvedValue(true) },
      ...overrides,
    })

  beforeEach(() => {
    repo = repository()
  })

  it('requires explicit purpose and consent instead of inferring either from an email', async () => {
    const lifecycle = buildLifecycle()

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'guest@example.com',
        authority: AUTHORITY,
      }),
    ).rejects.toMatchObject({ code: 'consent_required' })
    expect(repo.create).not.toHaveBeenCalled()

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'guest@example.com',
        consent: true,
        authority: AUTHORITY,
      }),
    ).rejects.toMatchObject({ code: 'purpose_required' })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('validates and normalizes the email before fixing the 30-day lifecycle', async () => {
    const lifecycle = buildLifecycle()

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'not-an-email',
        consent: true,
        purpose: 'manager_follow_up',
        authority: AUTHORITY,
      }),
    ).rejects.toMatchObject({ code: 'invalid_contact' })

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: '  Guest@example.com  ',
        name: '  Guest Name  ',
        consent: true,
        purpose: 'manager_follow_up',
        authority: AUTHORITY,
      }),
    ).resolves.toEqual({ status: 'submitted' })
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenCalledWith({
      id: '10000000-0000-4000-8000-000000000004',
      scope: SCOPE,
      responseId: '10000000-0000-4000-8000-000000000005',
      purpose: 'manager_follow_up',
      consent: true,
      email: 'Guest@example.com',
      name: 'Guest Name',
      submittedAt: NOW,
      expiresAt: new Date('2026-09-25T09:00:00.000Z'),
    })
  })

  it('requires signed-session and CSRF authority bound to the exact response before submit', async () => {
    const authorize = vi.fn().mockResolvedValue(false)
    const lifecycle = buildLifecycle({
      responseAuthority: { authorize },
    })

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'guest@example.com',
        consent: true,
        purpose: 'manager_follow_up',
        authority: AUTHORITY,
      }),
    ).rejects.toMatchObject({ _tag: 'ContactRequestError', code: 'not_authorized' })
    expect(authorize).toHaveBeenCalledWith({
      action: 'submit',
      scope: SCOPE,
      responseId: '10000000-0000-4000-8000-000000000005',
      authority: AUTHORITY,
      at: NOW,
    })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('rejects unapproved contact purposes at runtime', async () => {
    const lifecycle = buildLifecycle()

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'guest@example.com',
        consent: true,
        purpose: 'marketing' as never,
        authority: AUTHORITY,
      }),
    ).rejects.toMatchObject({ code: 'invalid_purpose' })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('returns only the masked projection on ordinary reads', async () => {
    vi.mocked(repo.findMasked).mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000004',
      scope: SCOPE,
      responseId: '10000000-0000-4000-8000-000000000005',
      purpose: 'manager_follow_up',
      maskedContact: '••••••••',
      submittedAt: NOW,
      expiresAt: new Date('2026-09-25T09:00:00.000Z'),
    })
    const lifecycle = buildLifecycle()

    const result = await lifecycle.getMasked(
      {
        ...SCOPE,
        contactRequestId: '10000000-0000-4000-8000-000000000004',
      },
      MANAGER_CTX,
    )

    expect(result).toEqual({
      id: '10000000-0000-4000-8000-000000000004',
      responseId: '10000000-0000-4000-8000-000000000005',
      purpose: 'manager_follow_up',
      maskedContact: '••••••••',
      submittedAt: NOW.toISOString(),
      expiresAt: '2026-09-25T09:00:00.000Z',
    })
    expect(result).not.toHaveProperty('email')
    expect(repo.findMasked).toHaveBeenCalledWith({
      scope: SCOPE,
      contactRequestId: '10000000-0000-4000-8000-000000000004',
      authorization: {
        actorId: 'manager-1',
        basis: 'portal_creator',
        checkedAt: NOW,
      },
      asOf: NOW,
    })
  })

  it('requires the central policy to allow inbox.read and feedback.read for masked reads', async () => {
    vi.mocked(repo.findMasked).mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000004',
      scope: SCOPE,
      responseId: '10000000-0000-4000-8000-000000000005',
      purpose: 'manager_follow_up',
      maskedContact: '••••••••',
      submittedAt: NOW,
      expiresAt: new Date('2026-09-25T09:00:00.000Z'),
    })
    const decide = vi.fn(async (request: { action: string }) => ({
      allowed: request.action !== 'feedback.read',
      reason: request.action === 'feedback.read' ? 'permission_denied' : 'allowed',
    }))
    const lifecycle = buildLifecycle({ policy: { decide } })
    const ctx = buildTestAuthContext({
      organizationId: organizationId(SCOPE.organizationId),
      userId: userId('manager-1'),
    })

    await expect(
      lifecycle.getMasked(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000004',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ _tag: 'ContactRequestError', code: 'not_authorized' })
    expect(decide.mock.calls.map(([request]) => request.action)).toEqual([
      'inbox.read',
      'feedback.read',
    ])
    expect(repo.findMasked).not.toHaveBeenCalled()
  })

  it('reveals contact only through the audited repository command with an explicit access purpose', async () => {
    vi.mocked(repo.reveal).mockResolvedValue({
      outcome: 'revealed',
      email: 'guest@example.com',
      name: 'Guest Name',
    })
    const lifecycle = buildLifecycle()

    await expect(
      lifecycle.reveal(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000004',
        },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({
      code: 'access_purpose_required',
    })
    expect(repo.reveal).not.toHaveBeenCalled()

    await expect(
      lifecycle.reveal(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000004',
          accessPurpose: 'respond_to_contact_request',
        },
        MANAGER_CTX,
      ),
    ).resolves.toEqual({ email: 'guest@example.com', name: 'Guest Name' })
    expect(repo.reveal).toHaveBeenCalledWith({
      scope: SCOPE,
      contactRequestId: '10000000-0000-4000-8000-000000000004',
      authorization: {
        actorId: 'manager-1',
        basis: 'portal_creator',
        checkedAt: NOW,
      },
      auditId: '10000000-0000-4000-8000-000000000099',
      accessPurpose: 'respond_to_contact_request',
      at: NOW,
    })
  })

  it('fails closed when the owning contexts do not resolve a current manager basis', async () => {
    const resolve = vi.fn().mockResolvedValue(null)
    const lifecycle = buildLifecycle({ managerAuthority: { resolve } })

    await expect(
      lifecycle.getMasked(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000004',
        },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ _tag: 'ContactRequestError', code: 'not_authorized' })
    expect(resolve).toHaveBeenCalledWith({
      scope: SCOPE,
      actorId: 'manager-1',
      at: NOW,
    })
    expect(repo.findMasked).not.toHaveBeenCalled()
  })

  it.each(['account_admin', 'portal_creator', 'responsible_manager'] as const)(
    'passes the freshly resolved %s basis into the reveal audit',
    async (basis) => {
      vi.mocked(repo.reveal).mockResolvedValue({
        outcome: 'revealed',
        email: 'guest@example.com',
      })
      const resolve = vi.fn().mockResolvedValue(basis)
      const lifecycle = buildLifecycle({ managerAuthority: { resolve } })

      await lifecycle.reveal(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000004',
          accessPurpose: 'respond_to_contact_request',
        },
        MANAGER_CTX,
      )

      expect(resolve).toHaveBeenCalledWith({
        scope: SCOPE,
        actorId: 'manager-1',
        at: NOW,
      })
      expect(repo.reveal).toHaveBeenCalledWith(
        expect.objectContaining({
          authorization: { actorId: 'manager-1', basis, checkedAt: NOW },
          at: NOW,
        }),
      )
    },
  )

  it('requires all three manager permissions and derives the reveal actor from AuthContext', async () => {
    vi.mocked(repo.reveal).mockResolvedValue({
      outcome: 'revealed',
      email: 'guest@example.com',
    })
    const decide = vi.fn(async (request: { action: string }) => ({
      allowed: request.action !== 'feedback.contact_read',
      reason:
        request.action === 'feedback.contact_read' ? 'capability_blocked' : 'allowed',
    }))
    const lifecycle = buildLifecycle({ policy: { decide } })
    const ctx = buildTestAuthContext({
      organizationId: organizationId(SCOPE.organizationId),
      userId: userId('manager-from-context'),
    })

    await expect(
      lifecycle.reveal(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000004',
          accessPurpose: 'respond_to_contact_request',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ _tag: 'ContactRequestError', code: 'not_authorized' })
    expect(decide.mock.calls.map(([request]) => request.action)).toEqual([
      'inbox.read',
      'feedback.read',
      'feedback.contact_read',
    ])
    expect(repo.reveal).not.toHaveBeenCalled()
  })

  it('maps unavailable reveal and withdrawal races to stable lifecycle errors', async () => {
    vi.mocked(repo.reveal).mockResolvedValue({ outcome: 'unavailable' })
    vi.mocked(repo.withdraw).mockResolvedValue({ outcome: 'unavailable' })
    const lifecycle = buildLifecycle()

    await expect(
      lifecycle.reveal(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000004',
          accessPurpose: 'respond_to_contact_request',
        },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      lifecycle.withdraw({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        contactRequestId: '10000000-0000-4000-8000-000000000004',
        authority: AUTHORITY,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('requires the same response authority before withdrawing contact', async () => {
    vi.mocked(repo.withdraw).mockResolvedValue({ outcome: 'withdrawn' })
    const authorize = vi.fn().mockResolvedValue(false)
    const lifecycle = buildLifecycle({ responseAuthority: { authorize } })

    await expect(
      lifecycle.withdraw({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        contactRequestId: '10000000-0000-4000-8000-000000000004',
        authority: AUTHORITY,
      }),
    ).rejects.toMatchObject({ _tag: 'ContactRequestError', code: 'not_authorized' })
    expect(authorize).toHaveBeenCalledWith({
      action: 'withdraw',
      scope: SCOPE,
      responseId: '10000000-0000-4000-8000-000000000005',
      authority: AUTHORITY,
      at: NOW,
    })
    expect(repo.withdraw).not.toHaveBeenCalled()
  })

  it('runs bounded purge batches and returns durable checkpoint evidence', async () => {
    const expiresAt = new Date('2026-08-01T00:00:00.000Z')
    vi.mocked(repo.purgeExpired).mockResolvedValue({
      processed: 1,
      checkpoint: {
        expiresAt,
        id: '10000000-0000-4000-8000-000000000004',
      },
      completedThrough: null,
    })
    const lifecycle = buildLifecycle()

    await expect(lifecycle.purgeExpired({ batchSize: 0 })).rejects.toMatchObject({
      code: 'invalid_batch_size',
    })
    await expect(lifecycle.purgeExpired({ batchSize: 100 })).resolves.toEqual({
      processed: 1,
      checkpoint: {
        expiresAt: expiresAt.toISOString(),
        id: '10000000-0000-4000-8000-000000000004',
      },
      completedThrough: null,
    })
    expect(repo.purgeExpired).toHaveBeenCalledWith({ through: NOW, batchSize: 100 })
  })
})
