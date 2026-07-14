// Inbox context — per-user last-visit view repository port
// Per architecture: "Ports are TypeScript interfaces, not classes."
//
// Stores the per-user `lastInboxView` timestamp that replaces the former
// org-level "new" badge (ADR 0023). The badge shows "N open items created
// since your last visit" — a per-user, time-based signal instead of the
// broken shared-column read-tracking it replaces.

import type { OrganizationId, UserId } from '#/shared/domain/ids'

export type InboxViewRepository = Readonly<{
  /** Returns the user's last inbox-view timestamp, or null if never visited. */
  getLastInboxView(orgId: OrganizationId, userId: UserId): Promise<Date | null>
  /** Stamps the user's last inbox-view to `now` (upsert). */
  stampLastInboxView(orgId: OrganizationId, userId: UserId, now?: Date): Promise<Date>
}>
