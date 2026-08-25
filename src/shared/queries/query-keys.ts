// Query-key factories — centralized so cache invalidation stays targeted.
//
// Convention: each context/feature exposes a factory whose keys form a hierarchy
// (parent keys are prefixes of child keys), so `invalidateQueries(parentKey)`
// refreshes all descendants. See TanStack Query "Query Keys" docs.
//
// Populated as features migrate to TanStack Query (inbox pilot first).

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (filters: Readonly<Record<string, unknown>>) =>
    [...inboxKeys.lists(), filters] as const,
  counts: () => [...inboxKeys.all, 'counts'] as const,
  // Per-property variant — invalidation via the counts() prefix still matches.
  countsFor: (propertyId?: string) =>
    [...inboxKeys.counts(), propertyId ?? 'all'] as const,
  lastVisitCount: () => [...inboxKeys.all, 'last-visit-count'] as const,
  details: () => [...inboxKeys.all, 'item'] as const,
  detail: (id: string) => [...inboxKeys.details(), id] as const,
  notes: (id: string) => [...inboxKeys.detail(id), 'notes'] as const,
  activity: (id: string) => [...inboxKeys.detail(id), 'activity'] as const,
}

// Two deliberately DISJOINT subtrees under `all`:
//
//   notifications → feed     → count | list   (the bell + /notifications)
//   notifications → settings → preferences | user-settings | email-capability
//
// They are siblings, not ancestor/descendant, because the feed is invalidated on
// every read/dismiss while the settings queries are 60s-cached. When `count` and
// `preferences` shared a `forOrganization(org)` parent, invalidating that parent
// — which merely OPENING the bell used to do — evicted the settings page's
// cache. Feed invalidation must never reach `settings`, so there is no key that
// spans both; `all` exists only for tenant-switch teardown.
export const notificationKeys = {
  all: ['notifications'] as const,

  // ── Feed (bell popover + /notifications page) ────────────────────────
  feed: (organizationId: string) =>
    [...notificationKeys.all, 'feed', organizationId] as const,
  count: (organizationId: string) =>
    [...notificationKeys.feed(organizationId), 'count'] as const,
  lists: (organizationId: string) =>
    [...notificationKeys.feed(organizationId), 'list'] as const,
  list: (organizationId: string, limit: number, filter = 'all') =>
    [...notificationKeys.lists(organizationId), { limit, filter }] as const,

  // ── Settings (/settings/notifications) ──────────────────────────────
  settings: (organizationId: string) =>
    [...notificationKeys.all, 'settings', organizationId] as const,
  preferences: (organizationId: string) =>
    [...notificationKeys.settings(organizationId), 'preferences'] as const,
  userSettings: (organizationId: string) =>
    [...notificationKeys.settings(organizationId), 'user-settings'] as const,
  /**
   * Per-property `notification.send_email` decision. Property-scoped because
   * the capability is allowlisted per property, so the answer changes with the
   * settings property selector.
   */
  emailCapability: (organizationId: string, propertyId: string) =>
    [
      ...notificationKeys.settings(organizationId),
      'email-capability',
      propertyId,
    ] as const,
}

// ── Identity / organization context ────────────────────────────────────
export const identityKeys = {
  all: ['identity'] as const,
  activeOrg: () => [...identityKeys.all, 'active-org'] as const,
  responseSla: () => [...identityKeys.all, 'response-sla'] as const,
  members: () => [...identityKeys.all, 'members'] as const,
  invitations: () => [...identityKeys.all, 'invitations'] as const,
  userInvitations: () => [...identityKeys.invitations(), 'user'] as const,
  organizationInvitations: () => [...identityKeys.invitations(), 'organization'] as const,
}

// ── Properties ──────────────────────────────────────────────────────────
export const propertyKeys = {
  all: ['properties'] as const,
  list: () => [...propertyKeys.all, 'list'] as const,
  detail: (propertyId: string) => [...propertyKeys.all, 'detail', propertyId] as const,
  responsibleManagers: (propertyId: string) =>
    [...propertyKeys.detail(propertyId), 'responsible-managers'] as const,
}

// ── Dashboard (fleet + per-property + staff) ─────────────────────────────
export const dashboardKeys = {
  all: ['dashboard'] as const,
  // Takes the range so an infinite cache entry exists per range. Existing
  // `invalidateQueries({ queryKey: dashboardKeys.fleet() })` calls still match
  // as a prefix.
  fleet: (timeRange = '30d') => [...dashboardKeys.all, 'fleet', timeRange] as const,
  staff: (args: Readonly<Record<string, unknown>>) =>
    [...dashboardKeys.all, 'staff', args] as const,
  property: (args: Readonly<Record<string, unknown>>) =>
    [...dashboardKeys.all, 'property', args] as const,
  googlePerformance: (
    propertyId: string,
    preset: string,
    catalogVersion: string,
    viewEpoch: number,
  ) =>
    [
      ...dashboardKeys.all,
      'google-performance',

      propertyId,
      preset,
      catalogVersion,
      viewEpoch,
    ] as const,
}
export const aiKeys = {
  all: ['ai'] as const,
  propertyTrend: (propertyId: string) =>
    [...aiKeys.all, 'property-trend', propertyId] as const,
  propertyAggregates: (propertyId: string) =>
    [...aiKeys.all, 'property-aggregates', propertyId] as const,
}

// ── Goals ────────────────────────────────────────────────────────────────
export const goalKeys = {
  all: ['goals'] as const,
  staff: (propertyId: string) => [...goalKeys.all, 'staff', propertyId] as const,
  list: (args: Readonly<Record<string, unknown>>) =>
    [...goalKeys.all, 'list', args] as const,
  detail: (goalId: string) => [...goalKeys.all, 'detail', goalId] as const,
}

// ── Staff participation and portal responsibility ────────────────────────
export const staffKeys = {
  all: ['staff'] as const,
  participations: (propertyId: string) =>
    [...staffKeys.all, 'participations', propertyId] as const,
  portals: (propertyId: string) => [...staffKeys.all, 'portals', propertyId] as const,
}

// ── Reviews (staff recent activity) ──────────────────────────────────────
export const reviewKeys = {
  all: ['reviews'] as const,
  staffActivity: (propertyId: string) =>
    [...reviewKeys.all, 'staff-activity', propertyId] as const,
}

// ── Teams ─────────────────────────────────────────────────────────────────
export const teamKeys = {
  all: ['teams'] as const,
  list: (propertyId: string) => [...teamKeys.all, 'list', propertyId] as const,
}

// ── Portals (detail + links + groups) ────────────────────────────────────
export const portalKeys = {
  all: ['portals'] as const,
  list: (propertyId: string) => [...portalKeys.all, 'list', propertyId] as const,
  detail: (portalId: string) => [...portalKeys.all, 'detail', portalId] as const,
  links: (portalId: string) => [...portalKeys.detail(portalId), 'links'] as const,
  responsibleManagers: (portalId: string) =>
    [...portalKeys.detail(portalId), 'responsible-managers'] as const,
  groups: (propertyId: string) => [...portalKeys.all, 'groups', propertyId] as const,
}

// ── Badges / recognition ─────────────────────────────────────────────────
export const badgeKeys = {
  all: ['badges'] as const,
  staffVisible: (propertyId: string) =>
    [...badgeKeys.all, 'staff-visible', propertyId] as const,
  target: (args: Readonly<Record<string, unknown>>) =>
    [...badgeKeys.all, 'target', args] as const,
  orgDefinitions: () => [...badgeKeys.all, 'org-definitions'] as const,
}

// ── Integrations (Google connections + bounded import content) ───────────
export const integrationKeys = {
  all: ['integrations'] as const,
  connections: () => [...integrationKeys.all, 'connections'] as const,
  googleImportContent: () => [...integrationKeys.all, 'google-import-content'] as const,
  googleImportAccounts: (organizationId: string, connectionId: string) =>
    [
      ...integrationKeys.googleImportContent(),
      organizationId,
      connectionId,
      'accounts',
    ] as const,
  googleImportCandidates: (
    organizationId: string,
    connectionId: string,
    accountRef: string | null,
  ) =>
    [
      ...integrationKeys.googleImportContent(),
      organizationId,
      connectionId,
      'candidates',
      accountRef,
    ] as const,
  googleImportLease: (organizationId: string, connectionId: string) =>
    [
      ...integrationKeys.googleImportContent(),
      organizationId,
      connectionId,
      'lease',
    ] as const,
  import: (importId: string) => [...integrationKeys.all, 'import', importId] as const,
}

// ── Guest / public portal ────────────────────────────────────────────────
export const guestKeys = {
  all: ['guest'] as const,
  publicPortal: (args: Readonly<Record<string, unknown>>) =>
    [...guestKeys.all, 'public-portal', args] as const,
}
