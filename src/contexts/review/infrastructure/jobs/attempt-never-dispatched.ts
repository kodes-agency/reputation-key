// Review context — D4's evidence check, shared by the two jobs that settle an
// uncertain reply publication attempt: the publish job reconciling its own
// attempt, and the ambiguous-publication sweep.

import type { ReplyPublicationDispatchEvidencePort } from '../../application/ports/reply-publication-dispatch-evidence.port'
import type { Reply } from '../../domain/types'

/**
 * D4: true only on positive evidence that the reply's current attempt never
 * left RepKey. An unavailable lookup proves nothing, so it answers false and
 * the caller takes the Google read path; `onLookupFailed` records that in the
 * caller's own log vocabulary.
 */
export async function attemptNeverDispatched(
  deps: Readonly<{
    dispatchEvidence: ReplyPublicationDispatchEvidencePort
    clock: () => Date
  }>,
  reply: Pick<
    Reply,
    'organizationId' | 'id' | 'publicationCycle' | 'publicationAttempts'
  >,
  attemptStartedAt: Date,
  onLookupFailed: (error: unknown) => void,
): Promise<boolean> {
  try {
    const evidence = await deps.dispatchEvidence.findDispatchEvidence({
      organizationId: reply.organizationId,
      replyId: reply.id,
      publicationCycle: reply.publicationCycle,
      attemptNumber: reply.publicationAttempts,
      attemptStartedAt,
      now: deps.clock(),
    })
    return evidence === 'never_dispatched'
  } catch (err) {
    onLookupFailed(err)
    return false
  }
}
