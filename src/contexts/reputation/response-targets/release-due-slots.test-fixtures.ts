type SlotReleaser<TKey> = Readonly<{
  listDueReminderCandidates(
    input: Readonly<{ now: Date; limit: number }>,
  ): Promise<ReadonlyArray<Readonly<{ key: TKey }>>>
  releaseReminderSlot(input: Readonly<{ key: TKey; now: Date }>): Promise<string>
}>

/**
 * The tick's two steps without the Google check: list the due slots, then
 * release each in its own transaction. Counts the slots that queued a fact.
 */
export const releaseDueSlots = async <TKey>(
  targets: SlotReleaser<TKey>,
  input: Readonly<{ now: Date; limit: number }>,
): Promise<Readonly<{ released: number }>> => {
  const due = await targets.listDueReminderCandidates(input)
  let released = 0
  for (const { key } of due) {
    if ((await targets.releaseReminderSlot({ key, now: input.now })) === 'released') {
      released += 1
    }
  }
  return { released }
}
