import { replies } from '#/shared/db/schema/review.schema'
import type { Database } from '#/shared/db'
import { replyFromRow, replyToRow } from './reply-mapper.server'
import type { Reply } from '../domain/review-types'

/**
 * Seeds a Reply row for a test, or replaces the content of the one the review
 * already has. Production writes go through the Reply writer; this only
 * arranges rows.
 */
export async function seedReply(
  db: Database,
  reply: Omit<Reply, 'createdAt' | 'updatedAt'>,
  now: Date = new Date(),
): Promise<Reply> {
  const row = replyToRow(reply)
  const [saved] = await db
    .insert(replies)
    .values(row)
    .onConflictDoUpdate({
      target: [replies.reviewId, replies.source, replies.organizationId],
      set: {
        text: row.text,
        replyLanguageTag: row.replyLanguageTag,
        templateLayer: row.templateLayer,
        templateRef: row.templateRef,
        templateRevision: row.templateRevision,
        templateWordingKey: row.templateWordingKey,
        voiceDigest: row.voiceDigest,
        voiceChoices: row.voiceChoices,
        status: row.status,
        approvedBy: row.approvedBy,
        rejectedBy: row.rejectedBy,
        rejectionReason: row.rejectionReason,
        aiGenerated: row.aiGenerated,
        stateRevision: row.stateRevision,
        submittedAt: row.submittedAt,
        approvedAt: row.approvedAt,
        publishedAt: row.publishedAt,
        updatedAt: now,
      },
    })
    .returning()
  if (!saved) throw new Error('seedReply: no row returned')
  return replyFromRow(saved)
}
