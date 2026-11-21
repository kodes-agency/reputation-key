// The one log line for RepKey's own publication read-backs (the publish job's
// read after an uncertain write, and the reconcile sweep's read). It records
// what Google showed about moderation and nothing else: no reply text, no
// review, no wording. Logs only; no decision reads it. See
// docs/operations/runbooks.md ("Reply moderation read-back lines").

import type { LoggerPort } from '#/shared/domain/logger.port'
import { replyReadbackFacts, type ReplyModeration } from '../domain/reply-moderation'

type ReadbackReply = Readonly<{
  /** The text the attempt sent; compared, never logged. */
  text: string
  publicationCycle: number
  publicationAttempts: number
}>

export function reportReplyReadback(
  logger: Pick<LoggerPort, 'info'>,
  input: Readonly<{
    source: 'publish_readback' | 'reconcile_sweep'
    reply: ReadbackReply
    observedText: string | null
    moderation: ReplyModeration | undefined
  }>,
): void {
  logger.info(
    {
      event: 'reply_publication_readback',
      source: input.source,
      publicationCycle: input.reply.publicationCycle,
      attemptNumber: input.reply.publicationAttempts,
      ...replyReadbackFacts({
        moderation: input.moderation,
        observedText: input.observedText,
        attemptText: input.reply.text,
      }),
    },
    'Google reply read back for a publication attempt',
  )
}
