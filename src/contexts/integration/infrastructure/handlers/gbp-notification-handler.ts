// Integration context — GBP notification handler
// Per architecture: infrastructure handler that wraps the use case.
// Called from the webhook route after JWT verification.
// This is NOT a createServerFn — it's a server-side function invoked
// by the file route handler (webhooks are push-based, not RPC).

import { getContainer } from '#/composition'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import type {
  HandleGbpNotificationInput,
  HandleGbpNotificationResult,
} from '../../application/use-cases/handle-gbp-notification'

/**
 * Handles a GBP Pub/Sub notification after JWT verification.
 * Looks up the property, enqueues a review sync job.
 */
export async function handleGbpNotification(
  input: HandleGbpNotificationInput,
): Promise<HandleGbpNotificationResult> {
  return trace('integration.handleGbpNotification', async () => {
    const logger = getLogger()
    const container = getContainer()

    const result = await container.useCases.handleGbpNotification(input)

    if (!result.enqueued) {
      logger.info(
        { locationId: input.locationId, reason: result.reason },
        'GBP notification processed — no job enqueued',
      )
    }

    return result
  })
}
