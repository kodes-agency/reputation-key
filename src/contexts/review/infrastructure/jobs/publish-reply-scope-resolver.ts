// Review context — BQC-3.2 dispatch-time scope resolver for publish-reply.
//
// The publish-reply envelope carries replyId + organizationId only; the
// delayed execution gate needs the property scope to authorize
// (system:reply.publish is property-scoped in the entry-point catalogue).
// Resolve reply → review → propertyId at dispatch with an identifier-only
// lookup — no reply text or reviewer content crosses the gate.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { replies, reviews } from '#/shared/db/schema/review.schema'
import type { ScopeResolver } from '#/shared/jobs/delayed-execution-gate'
import { JOB_NAME } from './publish-reply.job'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * ScopeResolver for the worker dispatch gate. Handles exactly one job
 * (publish-reply); every other job name resolves to undefined so the gate
 * falls back to payload-carried scope or missing_scope denial.
 */
export function createPublishReplyScopeResolver(deps: { db: Database }): ScopeResolver {
  return async (jobName, data) => {
    if (jobName !== JOB_NAME || !isRecord(data)) return undefined
    const { replyId, organizationId } = data
    if (typeof replyId !== 'string' || typeof organizationId !== 'string')
      return undefined
    const rows = await deps.db
      .select({ propertyId: reviews.propertyId })
      .from(replies)
      .innerJoin(reviews, eq(replies.reviewId, reviews.id))
      .where(and(eq(replies.id, replyId), eq(replies.organizationId, organizationId)))
      .limit(1)
    return rows[0]?.propertyId
  }
}
