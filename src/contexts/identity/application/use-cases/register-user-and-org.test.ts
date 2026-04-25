// Identity context — register user and org use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// Use cases THROW tagged errors at the application boundary — never return { success: false }.

import { describe, it, expect, vi } from 'vitest'
import { registerUserAndOrg } from './register-user-and-org'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { isIdentityError } from '../../domain/errors'

const FIXED_USER_ID = 'user-new-00000000-0000-0000-0000-000000000001'
const FIXED_ORG_ID = 'org-new-00000000-0000-0000-0000-000000000001'

const setup = () => {
  const events = createCapturingEventBus()
  const headers = () => new Headers()

  const deps = {
    events,
    signUp: vi.fn().mockResolvedValue(FIXED_USER_ID),
    createOrg: vi.fn().mockResolvedValue(FIXED_ORG_ID),
    setActiveOrg: vi.fn().mockResolvedValue(undefined),
    headers,
  }

  const useCase = registerUserAndOrg(deps)

  return { useCase, deps, events }
}

describe('registerUserAndOrg', () => {
  const validInput = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    organizationName: 'Test Org',
  }

  it('registers a user and creates an organization', async () => {
    const { useCase, deps } = setup()

    const result = await useCase(validInput)

    expect(result.organizationId).toBe(FIXED_ORG_ID)
    expect(deps.signUp).toHaveBeenCalledWith(
      'Test User',
      'test@example.com',
      'password123',
    )
    expect(deps.createOrg).toHaveBeenCalledWith(
      expect.any(Headers),
      'Test Org',
      'test-org',
      FIXED_USER_ID,
    )
    expect(deps.setActiveOrg).toHaveBeenCalledWith(expect.any(Headers), FIXED_ORG_ID)
  })

  it('emits organization.created event', async () => {
    const { useCase, events } = setup()

    await useCase(validInput)

    const emitted = events.capturedByTag('organization.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].organizationName).toBe('Test Org')
    expect(emitted[0].slug).toBe('test-org')
  })

  it('normalizes the org name into a slug', async () => {
    const { useCase, deps } = setup()

    await useCase({ ...validInput, organizationName: 'My Awesome Org!!!' })

    expect(deps.createOrg).toHaveBeenCalledWith(
      expect.any(Headers),
      'My Awesome Org!!!',
      'my-awesome-org',
      FIXED_USER_ID,
    )
  })

  it('validates organization name using domain rules', async () => {
    const { useCase } = setup()

    await expect(useCase({ ...validInput, organizationName: 'A' })).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invalid_name',
    )
  })

  it('throws registration_failed when sign-up fails', async () => {
    const { useCase, deps } = setup()
    deps.signUp.mockRejectedValueOnce(new Error('Email already taken'))

    await expect(useCase(validInput)).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) &&
        e.code === 'registration_failed' &&
        isIdentityError(e) &&
        e.message.includes('Email already taken'),
    )
    // Should not attempt org creation
    expect(deps.createOrg).not.toHaveBeenCalled()
  })

  it('throws org_setup_failed when org creation fails', async () => {
    const { useCase, deps } = setup()
    deps.createOrg.mockRejectedValueOnce(new Error('Slug conflict'))

    await expect(useCase(validInput)).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) &&
        e.code === 'org_setup_failed' &&
        e.message.includes('Slug conflict'),
    )
    // Sign-up should have succeeded
    expect(deps.signUp).toHaveBeenCalled()
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
