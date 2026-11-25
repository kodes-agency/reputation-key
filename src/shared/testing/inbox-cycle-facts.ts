/**
 * Fixtures that seed an Inbox item's current Handling Cycle by hand call this
 * after inserting the item and its cycle, so the Inbox row carries the facts the
 * stores leave on it: the cycle number, the source revision, the state revision,
 * the status.
 */
export type InboxItemCycleFacts = Readonly<{
  itemId: string
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
  status: 'open' | 'closed'
}>

type Queryable = Readonly<{
  query: (text: string, params?: unknown[]) => Promise<unknown>
}>

export async function setInboxItemCycleFacts(
  db: Queryable,
  facts: InboxItemCycleFacts,
): Promise<void> {
  await db.query(
    `UPDATE inbox_items
        SET current_cycle_number = $2,
            current_source_revision = $3,
            state_revision = $4,
            status = $5
      WHERE id = $1`,
    [
      facts.itemId,
      facts.cycleNumber,
      facts.sourceRevision,
      facts.stateRevision,
      facts.status,
    ],
  )
}
