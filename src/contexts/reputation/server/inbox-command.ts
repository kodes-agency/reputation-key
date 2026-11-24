// Inbox context — the preamble and error mapping every Inbox server function runs.
//
// Only ever called from inside a server function handler. TanStack Start
// replaces those handlers with RPC stubs in the client build and drops the
// imports they alone used, so this module and the composition root behind it
// never reach the browser. Importing it anywhere a client module evaluates
// would pull server-only code past import protection.

import { getContainer, type Container } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { isInboxError, toInboxRevisionConflictResult } from '../domain/inbox-errors'
import { inboxErrorStatus } from './inbox-shared'

type InboxApi = Container['inboxPublicApi']

/**
 * The signed-in caller's tenant, with `action` allowed by the execution policy.
 * Runs before the Inbox API is touched.
 */
export async function inboxCaller(
  action: Permission,
  propertyId?: string,
): Promise<AuthContext> {
  const headers = await headersFromContext()
  const ctx = await resolveTenantContext(headers)
  await requireExecutionAllowed({ actor: ctx, action, propertyId })
  return ctx
}

/**
 * An InboxError reaches the client with its HTTP status and its sentence;
 * anything untagged is masked as a 500.
 */
export function rethrowInboxError(error: unknown): never {
  if (isInboxError(error)) {
    throwContextError('InboxError', error, inboxErrorStatus(error.code))
  }
  throw catchUntagged(error)
}

/** Runs one Inbox command for the signed-in caller. */
export async function runInboxCommand<T>(
  action: Permission,
  command: (inbox: InboxApi, ctx: AuthContext) => Promise<T>,
): Promise<T> {
  const ctx = await inboxCaller(action)
  const { inboxPublicApi } = getContainer()
  try {
    return await command(inboxPublicApi, ctx)
  } catch (e) {
    return rethrowInboxError(e)
  }
}

/**
 * As `runInboxCommand`, for a command carrying an expected revision: a stale
 * revision comes back as the conflict result the client retries once.
 */
export async function runInboxRevisionCommand<T>(
  action: Permission,
  command: (inbox: InboxApi, ctx: AuthContext) => Promise<T>,
) {
  const ctx = await inboxCaller(action)
  const { inboxPublicApi } = getContainer()
  try {
    return await command(inboxPublicApi, ctx)
  } catch (e) {
    if (isInboxError(e)) {
      const conflict = toInboxRevisionConflictResult(e)
      if (conflict) return conflict
    }
    return rethrowInboxError(e)
  }
}
