// Composition seam for short-lived, reviewed operator commands.
//
// Operators receive the complete Application Container, but its graph refuses
// ambient Redis, registers no jobs, and replaces every provider-facing command
// path with an explicit refusal. The executable boundary controls restrict this
// builder to scripts/ops.

import { createOperatorContainerGraph, type Container } from '#/composition'
import { createJobQueue } from '#/shared/jobs/queue'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import { OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE } from './google-provider-authority'

export type OperatorContainerOptions = Parameters<typeof createOperatorContainerGraph>[0]

export const OPERATOR_QUEUE_CONFIGURATION_ERROR =
  '[COMPOSITION] operator container requires QUEUE_REDIS_URL'

function operatorGraphOptions(
  options: OperatorContainerOptions,
): NonNullable<OperatorContainerOptions> {
  const queue = options?.queue ?? createJobQueue('default')
  const backgroundQueue = options?.backgroundQueue ?? createJobQueue('background')
  const opsBackgroundQueue = options?.opsBackgroundQueue ?? backgroundQueue
  const opsDomainEventsQueue =
    options?.opsDomainEventsQueue ?? createJobQueue('domain-events')
  const opsQuarantineQueue =
    options?.opsQuarantineQueue ?? createJobQueue(QUARANTINE_QUEUE_NAME)
  if (
    !queue ||
    !backgroundQueue ||
    !opsBackgroundQueue ||
    !opsDomainEventsQueue ||
    !opsQuarantineQueue
  ) {
    throw new Error(OPERATOR_QUEUE_CONFIGURATION_ERROR)
  }
  return {
    ...(options ?? {}),
    enableJobs: false,
    redis: undefined,
    queue,
    backgroundQueue,
    opsBackgroundQueue,
    opsDomainEventsQueue,
    opsQuarantineQueue,
  }
}

async function refuseOperatorGoogleProviderCall(): Promise<never> {
  throw new Error(OPERATOR_GOOGLE_PROVIDER_REFUSAL_MESSAGE)
}

/**
 * Provider-facing use cases intentionally flatten outages into best-effort
 * outcomes for long-lived application processes. The operator surface must not:
 * a provider-dependent command either runs through an enabled application path
 * or refuses before it can report a partial/local success as completion.
 */
function withOperatorProviderRefusals(container: Container): Container {
  return Object.freeze({
    ...container,
    integrationPublicApi: Object.freeze({
      ...container.integrationPublicApi,
      connections: Object.freeze({
        ...container.integrationPublicApi.connections,
        disconnect: refuseOperatorGoogleProviderCall,
      }),
    }),
    integrationMaintenanceRuntime: Object.freeze({
      ...container.integrationMaintenanceRuntime,
      subscribeNotifications: Object.freeze({
        ...container.integrationMaintenanceRuntime.subscribeNotifications,
        apply: refuseOperatorGoogleProviderCall,
      }),
    }),
    reviewMaintenanceRuntime: Object.freeze({
      ...container.reviewMaintenanceRuntime,
      publicationReconciliation: Object.freeze({
        ...container.reviewMaintenanceRuntime.publicationReconciliation,
        reconcile: refuseOperatorGoogleProviderCall,
      }),
    }),
  })
}

/** Build the refusing, job-free operator graph. Process ownership stays with its caller. */
export function createOperatorContainer(options?: OperatorContainerOptions): Container {
  return withOperatorProviderRefusals(
    createOperatorContainerGraph(operatorGraphOptions(options)),
  )
}
