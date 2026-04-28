// Identity context — register user use case tests
// Per architecture: "Every use case tested for happy path + every error path."

import { describe, it, expect, vi } from 'vitest'
import { registerUser } from './register-user'
import { isIdentityError } from '../../domain/errors'

const FIXED_USER_ID = 'user-new-00000000-0000-0000-0000-000000000001'

const setup = () => {
  const deps = {
    identity: {
      signUp: vi.fn().mockResolvedValue(FIXED_USER_ID),
    } as unknown as import('./register-user').RegisterUserDeps['identity'],
  }

  const useCase = registerUser(deps)

  return { useCase, deps }
}

describe('registerUser', () => {
  const validInput = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
  }

  it('registers a user and returns the user ID', async () => {
    const { useCase, deps } = setup()

    const result = await useCase(validInput)

    expect(result).toBe(FIXED_USER_ID)
    expect(deps.identity.signUp).toHaveBeenCalledWith(
      'Test User',
      'test@example.com',
      'password123',
    )
  })

  it('throws registration_failed when sign-up fails', async () => {
    const { useCase, deps } = setup()
    ;(deps.identity.signUp as unknown as import('vitest').Mock).mockRejectedValueOnce(
      new Error('Email already taken'),
    )

    await expect(useCase(validInput)).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) &&
        e.code === 'registration_failed' &&
        e.message.includes('Email already taken'),
    )
  })

  it('throws registration_failed with generic message for non-Error rejection', async () => {
    const { useCase, deps } = setup()
    ;(deps.identity.signUp as unknown as import('vitest').Mock).mockRejectedValueOnce(
      'some string rejection',
    )

    await expect(useCase(validInput)).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) &&
        e.code === 'registration_failed' &&
        e.message === 'Registration failed',
    )
  })
})
