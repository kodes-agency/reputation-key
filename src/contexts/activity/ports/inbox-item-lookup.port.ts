// Activity context — port for resolving inbox item IDs from source context IDs.
// Used by reply event handlers to map reviewId → inboxItemId so that reply
// activity entries appear in the inbox item timeline.

export type InboxItemLookupPort = Readonly<{
  /** Find an inbox item ID by its source (review/feedback) ID within an org. */
  findBySourceId(sourceId: string, orgId: string): Promise<string | null>
}>
