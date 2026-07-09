// Builds the full InboxServerFns bundle from an in-memory container, so a
// page-level story can render InboxPageV2 with REAL inbox use-case logic
// (list, folder counts, status transitions) — no DB, no RPC.
//
// Each fn bridges the server-fn contract ({ data } payload + tenant context
// injected from auth headers in the real app) to the real use-case, supplying
// the container's test org/user/role. The cross-context fn
// (getActivityTimeline → activity ctx) has no in-browser container, so it
// resolves the real empty contract (an empty array) — the detail pane renders
// gracefully, not as live logic.
//
// server-fn types carry createServerFn metadata the component never reads; the
// double cast bridges that unexpressible brand (same justification as the
// mockServerFn cast in mocks/mock-action.ts).
import { createInboxContainer, inboxTestIds } from './inbox-container'
import {
  getInboxItemsDto,
  getInboxItemDetailDto,
  getInboxNotesDto,
  updateStatusDto,
  addInboxNoteDto,
  bulkUpdateStatusDto,
} from '#/contexts/inbox/application/dto/inbox.dto'
import { propertyId, inboxItemId } from '#/shared/domain/ids'
import type { z } from 'zod/v4'
import type {
  getInboxItemsFn,
  getInboxItemDetailFn,
  getInboxNotesFn,
  getInboxFolderCountsFn,
  updateInboxStatusFn,
  addInboxNoteFn,
  bulkUpdateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type { InboxServerFns } from '#/components/inbox/types'
import type { AuthContext } from '#/shared/domain/auth-context'

type InboxContainer = ReturnType<typeof createInboxContainer>

export function makeInboxFns(container: InboxContainer): InboxServerFns {
  const { ORG, USER, role } = inboxTestIds
  const ctx = { organizationId: ORG, userId: USER, role } as AuthContext

  return {
    getInboxItems: (async ({ data }: { data: z.infer<typeof getInboxItemsDto> }) =>
      container.useCases.getInboxItems(
        {
          filters: {
            propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
            status: data.status,
            sourceType: data.sourceType,
            platform: data.platform,
            ratingMin: data.ratingMin,
            ratingMax: data.ratingMax,
            q: data.q,
            sourceDateFrom: data.sourceDateFrom,
            sourceDateTo: data.sourceDateTo,
          },
          limit: data.limit,
          // Cursor replication is out-of-scope: prod base64-encodes/validates the
          // cursor in the server fn before the use-case sees it; no story paginates.
          cursor: undefined,
        },
        ctx,
      )) as unknown as typeof getInboxItemsFn,

    getInboxItemDetail: (async ({
      data,
    }: {
      data: z.infer<typeof getInboxItemDetailDto>
    }) =>
      container.useCases.getInboxItemDetail(
        {
          inboxItemId: inboxItemId(data.inboxItemId),
        },
        ctx,
      )) as unknown as typeof getInboxItemDetailFn,

    getInboxNotes: (async ({ data }: { data: z.infer<typeof getInboxNotesDto> }) =>
      container.useCases.getInboxNotes(
        {
          inboxItemId: inboxItemId(data.inboxItemId),
        },
        ctx,
      )) as unknown as typeof getInboxNotesFn,

    // Folder counts are org-wide (no filters in the DTO); the real use-case
    // computes the per-folder tally over the seeded repo.
    getInboxFolderCounts: (async () =>
      container.useCases.getInboxFolderCounts(
        {},
        ctx,
      )) as unknown as typeof getInboxFolderCountsFn,

    updateInboxStatus: (async ({ data }: { data: z.infer<typeof updateStatusDto> }) =>
      container.useCases.updateInboxStatus(
        {
          inboxItemId: inboxItemId(data.inboxItemId),
          newStatus: data.status,
        },
        ctx,
      )) as unknown as typeof updateInboxStatusFn,

    addInboxNote: (async ({ data }: { data: z.infer<typeof addInboxNoteDto> }) =>
      container.useCases.addInboxNote(
        {
          inboxItemId: inboxItemId(data.inboxItemId),
          text: data.text,
        },
        ctx,
      )) as unknown as typeof addInboxNoteFn,

    bulkUpdateInboxStatus: (async ({
      data,
    }: {
      data: z.infer<typeof bulkUpdateStatusDto>
    }) =>
      container.useCases.bulkUpdateInboxStatus(
        {
          inboxItemIds: data.inboxItemIds.map((id) => inboxItemId(id)),
          newStatus: data.status,
        },
        ctx,
      )) as unknown as typeof bulkUpdateInboxStatusFn,

    // Cross-context — no in-browser container; honor the real return contracts
    // so the detail pane (mounted on item selection) renders gracefully empty
    // rather than crashing. getActivityTimeline returns a bare array, type-
    // checked against the real fn.
    getActivityTimeline: (async () => []) as unknown as typeof getActivityTimelineFn,
  }
}
