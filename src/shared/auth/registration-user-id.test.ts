import { describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import {
  generateBetterAuthDatabaseId,
  runWithRegistrationAuthIds,
} from './registration-user-id'

const authIds = (userId: string) => ({
  userId,
  credentialAccountId: `${userId}-account`,
  initialSessionId: `${userId}-session`,
})

describe('registration user ID override', () => {
  it('supplies the preallocated ID to Better Auth for exactly one user insert', async () => {
    await runWithRegistrationAuthIds(authIds('preallocated-user-id'), async () => {
      expect(generateBetterAuthDatabaseId({ model: 'user' })).toBe('preallocated-user-id')
      expect(() => generateBetterAuthDatabaseId({ model: 'user' })).toThrow(
        'registration user ID was requested more than once',
      )
    })
  })

  it('keeps concurrent registration IDs isolated across async work', async () => {
    const [first, second] = await Promise.all([
      runWithRegistrationAuthIds(authIds('user-a'), async () => {
        await Promise.resolve()
        return generateBetterAuthDatabaseId({ model: 'user' })
      }),
      runWithRegistrationAuthIds(authIds('user-b'), async () => {
        await Promise.resolve()
        return generateBetterAuthDatabaseId({ model: 'user' })
      }),
    ])

    expect([first, second]).toEqual(['user-a', 'user-b'])
  })

  it('preserves Better Auth default ID semantics for every other model', async () => {
    await runWithRegistrationAuthIds(authIds('user-only'), async () => {
      const accountId = generateBetterAuthDatabaseId({ model: 'account', size: 24 })
      const sessionId = generateBetterAuthDatabaseId({ model: 'session' })

      expect(accountId).toBe('user-only-account')
      expect(sessionId).toBe('user-only-session')
      expect(generateBetterAuthDatabaseId({ model: 'user' })).toBe('user-only')
      expect(generateBetterAuthDatabaseId({ model: 'verification', size: 24 })).toMatch(
        /^[A-Za-z0-9]{24}$/,
      )
    })
  })

  it('uses Better Auth-compatible random IDs outside registration', () => {
    expect(generateBetterAuthDatabaseId({ model: 'user', size: 12 })).toMatch(
      /^[A-Za-z0-9]{12}$/,
    )
  })

  it('rejects an empty preallocated ID before entering provider code', async () => {
    await expect(
      runWithRegistrationAuthIds(authIds('  '), async () => undefined),
    ).rejects.toThrow('registration auth IDs must not be empty')
  })

  it('is honored by the pinned Better Auth sign-up transaction', async () => {
    const memory: Record<string, Array<Record<string, unknown>>> = {
      user: [],
      account: [],
      session: [],
      verification: [],
    }
    const auth = betterAuth({
      database: memoryAdapter(memory),
      baseURL: 'http://localhost:3000',
      secret: 'registration-id-characterization-secret-32-bytes',
      emailAndPassword: { enabled: true, autoSignIn: false },
      advanced: {
        database: { generateId: generateBetterAuthDatabaseId },
      },
    })

    const result = await runWithRegistrationAuthIds(
      authIds('durable-registration-user'),
      () =>
        auth.api.signUpEmail({
          body: {
            name: 'Invited Manager',
            email: 'invited@example.com',
            password: 'safe-password',
          },
        }),
    )

    expect(result.user.id).toBe('durable-registration-user')
    expect(memory.user).toEqual([
      expect.objectContaining({ id: 'durable-registration-user' }),
    ])
    expect(memory.account?.[0]?.id).toBe('durable-registration-user-account')
  })
})
