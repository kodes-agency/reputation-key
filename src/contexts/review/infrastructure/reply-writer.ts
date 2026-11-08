import type { Database } from '#/shared/db'
import {
  createReplyWriter,
  type ReplyWriterRows,
} from '#/contexts/reputation/application/public-api'
import type { ReplyWriter } from '#/contexts/review/application/public-api'
import { aiDraftInputsAreCurrent, assertCurrentAiDraftBinding } from './ai-draft-binding'
import { replyFromRow, replyToRow } from './mappers/reply.mapper'
import { buildReplySetClause } from './reply-set-clause'
import { lockReplyTruthScope } from './reply-truth-serialization'

const replyWriterRows: ReplyWriterRows = {
  replyFromRow,
  replyToRow,
  buildReplySetClause,
  lockReplyTruthScope,
  assertCurrentAiDraftBinding,
  aiDraftInputsAreCurrent,
}

/** The Reply writer, built with Review's row helpers. */
export const createReviewReplyWriter = (db: Database, clock: () => Date): ReplyWriter =>
  createReplyWriter({ db, clock, rows: replyWriterRows })
