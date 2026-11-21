import type { Database } from '#/shared/db'
import { createReplyWriter, type ReplyWriterRows } from '#/contexts/reputation/public-api'
import type { ReplyWriter } from '#/contexts/review/application/public-api'
import {
  aiDraftInputsAreCurrent,
  assertCurrentAiDraftBinding,
} from './ai-draft-binding.server'
import { replyFromRow, replyToRow } from './reply-mapper.server'
import { buildReplySetClause } from './reply-set-clause.server'
import { lockReplyTruthScope } from '../reviews/reply-truth-serialization.server'

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
