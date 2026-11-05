import { decidePublicExecution, refuseDecision } from '#/shared/auth/execution-policy'
import { getRequestContext } from '#/shared/observability/request-context'
import { commandHandler } from './command.server'
import type {
  CommandError,
  PublicCommandOptions,
  PublicCommandRequest,
  PublicCommandScope,
} from './contracts'

/** Public scope comes from a server lookup; it never becomes a manager session. */
export function publicCommand<T, S extends PublicCommandScope, R, E extends CommandError>(
  options: PublicCommandOptions<T, S, E>,
  run: (request: PublicCommandRequest<T, S>) => Promise<R>,
): (request: { data: T }) => Promise<R> {
  return commandHandler(options, async ({ data, headers }) => {
    const scope = await options.resolveScope({ data, headers })
    const request = { data, headers, scope }
    await options.limit(request)
    const decision = await decidePublicExecution({
      ...options.execution(request),
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      now: new Date(),
      correlationId: getRequestContext()?.requestId,
    })
    if (!decision.allowed) refuseDecision(decision)
    return run(request)
  })
}
