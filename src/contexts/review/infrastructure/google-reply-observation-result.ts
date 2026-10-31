import type { googleReplyObservations } from '#/shared/db/schema/review.schema'
import { replyId } from '#/shared/domain/ids'
import type { GoogleReplyObservationResult } from '../application/ports/google-reply-observation-store.port'
type ObservationRow = typeof googleReplyObservations.$inferSelect

export function resultFromRow(
  row: Pick<
    ObservationRow,
    | 'observationRevision'
    | 'change'
    | 'resolution'
    | 'matchedReplyId'
    | 'matchedPublicationCycle'
  >,
  duplicate: boolean,
): GoogleReplyObservationResult {
  return {
    observationRevision: row.observationRevision,
    change: row.change as GoogleReplyObservationResult['change'],
    resolution: row.resolution as GoogleReplyObservationResult['resolution'],
    matchedReplyId: row.matchedReplyId ? replyId(row.matchedReplyId) : null,
    matchedPublicationCycle: row.matchedPublicationCycle,
    duplicate,
  }
}
