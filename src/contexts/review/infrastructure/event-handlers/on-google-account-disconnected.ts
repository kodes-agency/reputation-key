// Review context — integration.google_account.disconnected consumer (BQC-3.8).
//
// A revoked Google connection must not leave a reply publication in flight:
// every active publication (requested/authorized/sending) on the connection's
// reviews is cancelled (publication_state → 'cancelled', status → 'draft',
// one review.reply.publication_cancelled fact per reply). A publish job
// holding a claim then loses its post-call re-read guard against the
// cancelled (or purge-deleted) row and returns without marking.
//
// Review resolution mirrors the source-content purge
// (reviews.google_connection_id within the organization) — the disconnected
// fact carries connectionId + organizationId, which is all the use case needs.

import type { IntegrationGoogleAccountDisconnected } from '#/contexts/integration/application/public-api'
import type { CancelPublicationsForConnection } from '../../application/use-cases/cancel-publications'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnGoogleAccountDisconnectedDeps = Readonly<{
  cancelPublicationsForConnection: CancelPublicationsForConnection
}>

export const onGoogleAccountDisconnected =
  (deps: OnGoogleAccountDisconnectedDeps) =>
  async (event: IntegrationGoogleAccountDisconnected): Promise<void> => {
    return trace('event.review.onGoogleAccountDisconnected', async () => {
      const logger = getLogger()
      logger.info(
        {
          connectionId: event.connectionId,
          organizationId: event.organizationId,
        },
        'integration.google_account.disconnected: cancelling in-flight reply publications',
      )
      const result = await deps.cancelPublicationsForConnection({
        organizationId: event.organizationId,
        connectionId: event.connectionId,
        cause: 'disconnect',
      })
      logger.info(
        { connectionId: event.connectionId, ...result },
        'integration.google_account.disconnected: reply publication cancellation complete',
      )
    })
  }
