import { AsyncLocalStorage } from 'node:async_hooks'
import { generateRandomString } from 'better-auth/crypto'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'

type RegistrationIdContext = {
  readonly expectedIds: RegistrationAuthIds
  readonly consumedModels: Set<string>
}

type BetterAuthIdRequest = Readonly<{
  model: string
  size?: number
}>

const registrationIdContext = new AsyncLocalStorage<RegistrationIdContext>()

/**
 * Runs one Better Auth call with a durable, caller-preallocated user ID.
 *
 * Better Auth creates the user inside its own transaction. A registration
 * recovery record therefore has to know the exact ID before that transaction
 * starts; otherwise a process crash after provider commit leaves an account
 * that cannot be attributed safely to the interrupted registration.
 */
export async function runWithRegistrationAuthIds<T>(
  expectedIds: RegistrationAuthIds,
  operation: () => Promise<T> | T,
): Promise<T> {
  if (Object.values(expectedIds).some((value) => value.trim().length === 0)) {
    throw new Error('registration auth IDs must not be empty')
  }

  return await registrationIdContext.run(
    { expectedIds, consumedModels: new Set() },
    operation,
  )
}

/**
 * Better Auth `advanced.database.generateId` implementation.
 *
 * The first `user`, credential `account`, and optional initial `session` ID
 * requests in an explicitly scoped registration are overridden. All other
 * models and all ordinary auth traffic retain Better Auth 1.6's documented
 * 32-character alphanumeric default (or its requested size).
 */
export function generateBetterAuthDatabaseId({
  model,
  size,
}: BetterAuthIdRequest): string {
  const context = registrationIdContext.getStore()
  const expectedId = context
    ? {
        user: context.expectedIds.userId,
        account: context.expectedIds.credentialAccountId,
        session: context.expectedIds.initialSessionId,
      }[model]
    : undefined
  if (context && expectedId) {
    if (context.consumedModels.has(model)) {
      throw new Error(`registration ${model} ID was requested more than once`)
    }
    context.consumedModels.add(model)
    return expectedId
  }

  return generateRandomString(size ?? 32, 'a-z', 'A-Z', '0-9')
}
