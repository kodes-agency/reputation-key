import {
  matchesExpectedReply,
  replyRevisionSchema,
  type ReplyRevision,
} from '#/shared/reply-revision'

export { matchesExpectedReply, replyRevisionSchema, type ReplyRevision }

/** A Google observation is displayed as a reply but has no internal draft row. */
export function replyRevisionOnScreen(
  reply: Readonly<{ id: string; stateRevision?: number }> | null | undefined,
): ReplyRevision | null | undefined {
  if (reply === undefined) return undefined
  return reply?.stateRevision === undefined
    ? null
    : { id: reply.id, stateRevision: reply.stateRevision }
}

/** A re-fetch cannot authorize overwriting words composed against an older reply. */
export function createDraftRevisionFence(reviewId: string) {
  let expected: ReplyRevision | null | undefined
  let composing = false
  let pending: Promise<unknown> = Promise.resolve()
  return {
    reviewId,
    showReadOnly(onScreen: ReplyRevision | null | undefined) {
      if (onScreen === undefined) return
      composing = false
      if (
        expected?.id === onScreen?.id &&
        expected &&
        onScreen &&
        expected.stateRevision > onScreen.stateRevision
      )
        return
      expected =
        onScreen === undefined || onScreen === null
          ? onScreen
          : { id: onScreen.id, stateRevision: onScreen.stateRevision }
    },
    beforeWrite(onScreen: ReplyRevision | null | undefined) {
      if ((!composing || expected === undefined) && onScreen !== undefined) {
        composing = true
        if (
          expected &&
          onScreen &&
          expected.id === onScreen.id &&
          expected.stateRevision > onScreen.stateRevision
        )
          return expected
        expected =
          onScreen === null
            ? null
            : { id: onScreen.id, stateRevision: onScreen.stateRevision }
      }
      return expected
    },
    didWrite(saved: ReplyRevision) {
      // Two completed writes can be delivered in the opposite order.
      if (expected?.id === saved.id && expected.stateRevision > saved.stateRevision)
        return
      expected = { id: saved.id, stateRevision: saved.stateRevision }
      composing = true
    },
    didDelete() {
      expected = null
      composing = true
    },
    enqueue<T>(write: () => Promise<T>): Promise<T> {
      const result = pending.then(write)
      pending = result.catch(() => undefined)
      return result
    },
  }
}
