/**
 * Fixtures that write a Handling Cycle head by hand run this afterwards so the
 * Inbox row carries the same cycle facts and status, as the stores leave them.
 */
export const SYNC_INBOX_ITEMS_FROM_HEADS_SQL = `
  UPDATE inbox_items AS item
     SET current_cycle_number = head.current_cycle_number,
         current_source_revision = head.current_source_revision,
         state_revision = head.state_revision,
         status = head.status
    FROM inbox_handling_cycle_heads AS head
   WHERE head.inbox_item_id = item.id`
