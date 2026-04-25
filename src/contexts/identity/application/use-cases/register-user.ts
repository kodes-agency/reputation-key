// Identity context — register user (no organization) use case
// Used by invited members joining an existing org via /join.
// Per architecture: anonymous use case — no AuthContext, no tenant, no event.

import type { IdentityPort } from '../ports/identity.port'
import { identityError } from '../../domain/errors'

export type RegisterUserInput = Readonly<{
  name: string
  email: string
  password: string
}>

export type RegisterUserDeps = Readonly<{
  identity: IdentityPort
}>

/**
 * Register a new user account without creating an organization.
 *
 * The user will join an existing organization by accepting an invitation
 * after registration. The accept-invitation flow handles org membership.
 *
 * Steps:
 * 1. Sign up user via auth port
 * 2. Return user ID
 */
export const registerUser =
  (deps: RegisterUserDeps) =>
  async (input: RegisterUserInput): Promise<string> => {
    try {
      const userId = await deps.identity.signUp(input.name, input.email, input.password)
      return userId
    } catch (e) {
      throw identityError(
        'registration_failed',
        e instanceof Error ? e.message : 'Registration failed',
      )
    }
  }
