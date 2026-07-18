// Identity context — register user and org use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// Use cases THROW tagged errors at the application boundary — never return { success: false }.
// BQC-3.5: the organization + owner-member rows and the created fact go
// through the sequential command-store fake.

import { describe, it, expect, vi } from 'vitest'
import { registerUserAndOrg } from './register-user-and-org'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { isIdentityError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'

const FIXED_USER_ID = 'user-new-00000000-0000-0000-0000-000000000001'
const FIXED_ORG_ID = 'org-new-00000000-0000-0000-0000-000000000001'
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const events = createCapturingEventBus()
  const commandStore = createSequentialIdentityCommandStore({ events })

  const deps = {
    signUp: vi.fn().mockResolvedValue(FIXED_USER_ID),
    setActiveOrg: vi.fn().mockResolvedValue(undefined),
    clock: () => FIXED_TIME,
    idGen: () => organizationId(FIXED_ORG_ID),
    commandStore,
    deleteUser: vi.fn().mockResolvedValue(undefined),
    logger: { error: vi.fn() },
  }

  const useCase = registerUserAndOrg(deps)

  return { useCase, deps, events, commandStore }
}

describe('registerUserAndOrg', () => {
  const validInput = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    organizationName: 'Test Org',
  }

  it('registers a user and creates an organization', async () => {
    const { useCase, deps, commandStore } = setup()

    const result = await useCase(validInput)

    expect(result.organizationId).toBe(FIXED_ORG_ID)
    expect(deps.signUp).toHaveBeenCalledWith(
      'Test User',
      'test@example.com',
      'password123',
    )
    // Organization + owner member persisted atomically by the command store
    const org = commandStore.organizationById(FIXED_ORG_ID)
    expect(org).toMatchObject({ name: 'Test Org', slug: 'test-org' })
    expect(
      commandStore.allMembers.some(
        (m) => m.organizationId === FIXED_ORG_ID && m.userId === FIXED_USER_ID,
      ),
    ).toBe(true)
    expect(deps.setActiveOrg).toHaveBeenCalledWith(FIXED_ORG_ID)
  })

  it('emits organization.created event', async () => {
    const { useCase, events } = setup()

    await useCase(validInput)

    const emitted = events.capturedByTag('identity.organization.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].organizationName).toBe('Test Org')
    expect(emitted[0].slug).toBe('test-org')
    expect(emitted[0].occurredAt).toBe(FIXED_TIME)
  })

  it('normalizes the org name into a slug', async () => {
    const { useCase, commandStore } = setup()

    await useCase({ ...validInput, organizationName: 'My Awesome Org!!!' })

    expect(commandStore.organizationById(FIXED_ORG_ID)?.slug).toBe('my-awesome-org')
  })

  it('validates organization name using domain rules', async () => {
    const { useCase } = setup()

    await expect(useCase({ ...validInput, organizationName: 'A' })).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invalid_name',
    )
  })

  it('throws registration_failed when sign-up fails', async () => {
    const { useCase, deps, commandStore } = setup()
    deps.signUp.mockRejectedValueOnce(new Error('Email already taken'))

    await expect(useCase(validInput)).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) &&
        e.code === 'registration_failed' &&
        e.message.includes('Email already taken'),
    )
    // Should not attempt org creation
    expect(commandStore.organizationById(FIXED_ORG_ID)).toBeNull()
  })

  it('throws org_setup_failed and compensates when org creation fails', async () => {
    const { useCase, deps, commandStore } = setup()
    // Slug conflict inside the store's guarded write
    commandStore.seedOrganization({
      id: 'org-existing',
      name: 'Existing Org',
      slug: 'test-org',
      createdAt: new Date('2026-01-01'),
    })

    await expect(useCase(validInput)).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) && e.code === 'org_setup_failed' && e.message.includes('slug'),
    )
    // Sign-up succeeded, so the compensating transaction removes the user
    expect(deps.signUp).toHaveBeenCalled()
    expect(deps.deleteUser).toHaveBeenCalledWith(FIXED_USER_ID)
  })

  it('does not emit event when registration fails', async () => {
    const { useCase, deps, events } = setup()
    deps.signUp.mockRejectedValueOnce(new Error('fail'))

    try {
      await useCase(validInput)
    } catch {
      // expected throw
    }

    expect(events.capturedEvents).toHaveLength(0)
  })
})
