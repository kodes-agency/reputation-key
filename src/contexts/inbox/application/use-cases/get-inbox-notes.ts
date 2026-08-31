// Inbox context — get inbox notes use case
// Returns all notes for a single inbox item.
// Enforces role-scoped property access.

import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItemId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import { assertInboxSourcePropertyAccessible, canReadInboxSource } from '../inbox-access'
import type { InboxActorDirectory } from '../ports/inbox-actor-directory.port'

export type GetInboxNotesInput = Readonly<{
  inboxItemId: InboxItemId
}>

/**
 * IBX-01-T6: the note plus the author's current display name. `displayName`
 * stays OUT of the `InboxNote` domain type on purpose — a name is mutable
 * profile data resolved at read time, not a fact the note records.
 * `null` means "not resolvable in this Organization"; the renderer shows an
 * opaque placeholder and never the raw id.
 */
export type InboxNoteView = InboxNote & Readonly<{ displayName: string | null }>

export type GetInboxNotesDeps = Readonly<{
  noteRepo: InboxNoteRepository
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
  actorDirectory: InboxActorDirectory
}>

export const getInboxNotes =
  (deps: GetInboxNotesDeps) =>
  async (
    input: GetInboxNotesInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<InboxNoteView>> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'Insufficient role to read inbox notes')
    }

    const item = await deps.repo.findById(input.inboxItemId, ctx.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }
    if (!canReadInboxSource(ctx, item.sourceType)) {
      throw inboxError('forbidden', 'No access to this inbox source')
    }

    // Enforce role-scoped property access via the shared guard.
    // Scope resolved per-permission: org-wide (AccountAdmin) → all accessible;
    // assigned scope (PropertyManager/Staff) → staff_assignment properties
    // (CONTEXT.md L72).
    await assertInboxSourcePropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'read',
      item.sourceType,
      item.propertyId,
    )

    const notes = await deps.noteRepo.findByInboxItemId(
      input.inboxItemId,
      ctx.organizationId,
    )
    // Exactly one directory call per request, whatever the note count: a
    // per-note lookup would be an N+1 on the detail pane's hot path.
    const names = await deps.actorDirectory.resolveDisplayNames(ctx.organizationId, [
      ...new Set(notes.map((note) => note.userId)),
    ])
    return notes.map((note) => ({
      ...note,
      displayName: names.get(note.userId) ?? null,
    }))
  }

export type GetInboxNotes = ReturnType<typeof getInboxNotes>
