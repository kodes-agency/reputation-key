# Inbox Tree Restructuring Plan

## Tree

### Chain A: updateInboxStatusFn
```
inbox/index.tsx  ──prop──→  InboxPage  ──prop──→  InboxDetailPanel  ──prop──→  InboxDetailContent
                                          └──prop──→  InboxDetailSheet  ──prop──→  (same)
```

### Chain B: bulkUpdateInboxStatusFn
```
inbox/index.tsx  ──prop──→  InboxPage  ──prop──→  InboxListPanel  ──prop──→  InboxBulkActions
```

## Files (7)

| # | File | Change |
|---|------|--------|
| 1 | `inbox/index.tsx` | Import both fns, pass to InboxPage |
| 2 | `inbox-page.tsx` | Accept props, forward to 3 children |
| 3 | `inbox-detail-panel.tsx` | Accept `updateStatusFn`, forward to InboxDetailContent |
| 4 | `inbox-detail-sheet.tsx` | Accept `updateStatusFn`, forward to InboxDetailContent |
| 5 | `inbox-list-panel.tsx` | Accept `bulkUpdateFn`, forward to InboxBulkActions |
| 6 | `inbox-detail-content.tsx` | Remove import + REVIEW, accept `updateStatusFn` prop |
| 7 | `inbox-bulk-actions.tsx` | Remove import + REVIEW, accept `bulkUpdateFn` prop |
