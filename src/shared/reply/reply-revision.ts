import { z } from 'zod/v4'

/** The reply a manager is looking at: its id and the revision the database advanced to. */
export const replyRevisionSchema = z.object({
  id: z.uuid(),
  stateRevision: z.number().int().positive().safe(),
})

export type ReplyRevision = z.infer<typeof replyRevisionSchema>

export function matchesExpectedReply(
  current: ReplyRevision | null,
  expected: ReplyRevision | null | undefined,
): boolean {
  return (
    expected === undefined ||
    (expected === null
      ? current === null
      : current?.id === expected.id && current.stateRevision === expected.stateRevision)
  )
}
