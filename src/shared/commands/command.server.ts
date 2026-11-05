import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import type {
  CommandError,
  CommandOptions,
  CommandRequest,
  TenantCommandOptions,
  TenantCommandRequest,
} from './contracts'

/** The server shell shared by tenant and public commands. */
export function commandHandler<T, R, E extends CommandError>(
  options: CommandOptions<E>,
  run: (request: CommandRequest<T>) => Promise<R>,
): (request: { data: T }) => Promise<R> {
  return tracedHandler(
    async ({ data }) => {
      try {
        return await run({ data, headers: await headersFromContext() })
      } catch (error) {
        if (isServerFunctionError(error)) throw error
        if (options.errors.is(error)) {
          throwContextError(options.errors.name, error, options.errors.status(error.code))
        }
        return catchUntagged(error)
      }
    },
    options.method,
    options.name,
  )
}

/** Organization membership and Property grants remain execution-policy decisions. */
export function command<T, R, E extends CommandError>(
  options: TenantCommandOptions<T, E>,
  run: (request: TenantCommandRequest<T>) => Promise<R>,
): (request: { data: T }) => Promise<R> {
  return commandHandler(options, async ({ data, headers }) => {
    const actor = await resolveTenantContext(headers)
    await requireExecutionAllowed({
      actor,
      action: options.action,
      ...(options.propertyId ? { propertyId: options.propertyId(data) } : {}),
    })
    return run({ data, headers, actor })
  })
}
