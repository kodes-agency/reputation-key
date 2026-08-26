export type InboxItemStatusObservation = Readonly<{
  itemId: string
  status: string | undefined
}>

/** Tracks polled status without treating an item selection change as a transition. */
export function createInboxItemStatusObserver() {
  let previous: InboxItemStatusObservation | null = null

  return {
    observe(current: InboxItemStatusObservation): boolean {
      const changed =
        previous !== null &&
        previous.itemId === current.itemId &&
        previous.status !== undefined &&
        current.status !== undefined &&
        previous.status !== current.status
      previous = current
      return changed
    },

    /** Records a mutation result already handled by the cache policy. */
    accept(current: InboxItemStatusObservation): void {
      previous = current
    },
  } as const
}

export type InboxItemStatusObserver = ReturnType<typeof createInboxItemStatusObserver>
