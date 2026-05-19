// Inbox context — inbox note repository port
// Per architecture: "Repository ports for all data access."

import type { InboxNote } from '../../domain/types'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'

export type InboxNoteRepository = Readonly<{
  findByInboxItemId(inboxItemId: InboxItemId, orgId: OrganizationId): Promise<ReadonlyArray<InboxNote>>
  create(note: InboxNote): Promise<InboxNote>
}>
