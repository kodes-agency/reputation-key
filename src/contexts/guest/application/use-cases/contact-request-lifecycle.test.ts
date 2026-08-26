import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contactRequestLifecycle } from './contact-request-lifecycle'
import type { ContactRequestRepository } from '../ports/contact-request.repository'

const NOW = new Date('2026-08-26T09:00:00.000Z')
const SCOPE = Object.freeze({
  organizationId: '10000000-0000-4000-8000-000000000001',
  propertyId: '10000000-0000-4000-8000-000000000002',
  portalId: '10000000-0000-4000-8000-000000000003',
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

  beforeEach(() => {
    repo = repository()
  })

  it('requires explicit purpose and consent instead of inferring either from an email', async () => {
    const lifecycle = contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => '10000000-0000-4000-8000-000000000004',
    })

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'guest@example.com',
      }),
    ).rejects.toMatchObject({ code: 'consent_required' })
    expect(repo.create).not.toHaveBeenCalled()

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'guest@example.com',
        consent: true,
      }),
    ).rejects.toMatchObject({ code: 'purpose_required' })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('validates and normalizes the email before fixing the 30-day lifecycle', async () => {
    const lifecycle = contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => '10000000-0000-4000-8000-000000000004',
    })

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'not-an-email',
        consent: true,
        purpose: 'manager_follow_up',
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

  it('rejects unapproved contact purposes at runtime', async () => {
    const lifecycle = contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => '10000000-0000-4000-8000-000000000004',
    })

    await expect(
      lifecycle.submit({
        ...SCOPE,
        responseId: '10000000-0000-4000-8000-000000000005',
        email: 'guest@example.com',
        consent: true,
        purpose: 'marketing' as never,
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
    const lifecycle = contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => 'unused',
    })

    const result = await lifecycle.getMasked({
      ...SCOPE,
      contactRequestId: '10000000-0000-4000-8000-000000000004',
    })

    expect(result).toEqual({
      id: '10000000-0000-4000-8000-000000000004',
      responseId: '10000000-0000-4000-8000-000000000005',
      purpose: 'manager_follow_up',
      maskedContact: '••••••••',
      submittedAt: NOW.toISOString(),
      expiresAt: '2026-09-25T09:00:00.000Z',
    })
    expect(result).not.toHaveProperty('email')
  })

  it('reveals contact only through the audited repository command with an explicit access purpose', async () => {
    vi.mocked(repo.reveal).mockResolvedValue({
      outcome: 'revealed',
      email: 'guest@example.com',
      name: 'Guest Name',
    })
    const lifecycle = contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => 'unused',
    })

    await expect(
      lifecycle.reveal({
        ...SCOPE,
        contactRequestId: '10000000-0000-4000-8000-000000000004',
        actorId: 'manager-1',
      }),
    ).rejects.toMatchObject({
      code: 'access_purpose_required',
    })
    expect(repo.reveal).not.toHaveBeenCalled()

    await expect(
      lifecycle.reveal({
        ...SCOPE,
        contactRequestId: '10000000-0000-4000-8000-000000000004',
        actorId: 'manager-1',
        accessPurpose: 'respond_to_contact_request',
      }),
    ).resolves.toEqual({ email: 'guest@example.com', name: 'Guest Name' })
    expect(repo.reveal).toHaveBeenCalledWith({
      scope: SCOPE,
      contactRequestId: '10000000-0000-4000-8000-000000000004',
      actorId: 'manager-1',
      accessPurpose: 'respond_to_contact_request',
      at: NOW,
    })
  })

  it('maps unavailable reveal and withdrawal races to stable lifecycle errors', async () => {
    vi.mocked(repo.reveal).mockResolvedValue({ outcome: 'unavailable' })
    vi.mocked(repo.withdraw).mockResolvedValue({ outcome: 'unavailable' })
    const lifecycle = contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => 'unused',
    })

    await expect(
      lifecycle.reveal({
        ...SCOPE,
        contactRequestId: '10000000-0000-4000-8000-000000000004',
        actorId: 'manager-1',
        accessPurpose: 'respond_to_contact_request',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      lifecycle.withdraw({
        ...SCOPE,
        contactRequestId: '10000000-0000-4000-8000-000000000004',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
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
    const lifecycle = contactRequestLifecycle({
      repo,
      clock: () => NOW,
      idGen: () => 'unused',
    })

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
