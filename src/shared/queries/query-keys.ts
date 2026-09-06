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
  responseTargetPolicies: (propertyId?: string) =>
    [...inboxKeys.all, 'response-target-policies', propertyId ?? 'organization'] as const,
  privateFeedbackTargetAnalytics: (propertyId?: string) =>
    [
      ...inboxKeys.all,
      'private-feedback-target-analytics',
      propertyId ?? 'organization',
    ] as const,
  googleReviewTargetAnalytics: (propertyId?: string) =>
    [
      ...inboxKeys.all,
      'google-review-target-analytics',
      propertyId ?? 'organization',
    ] as const,
}

// Two deliberately DISJOINT subtrees under `all`:
//
//   notifications → feed     → list → head   (the bell + /notifications)
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
  lists: (organizationId: string) =>
    [...notificationKeys.feed(organizationId), 'list'] as const,
  list: (organizationId: string, limit: number, filter = 'all') =>
    [...notificationKeys.lists(organizationId), { limit, filter }] as const,
  /**
   * Periodically refreshed first page. Older pages stay under `list(...)` so
   * an interval refresh never asks the server for the whole loaded history.
   */
  head: (organizationId: string, limit: number, filter = 'all') =>
    [...notificationKeys.list(organizationId, limit, filter), 'head'] as const,

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
  members: () => [...identityKeys.all, 'members'] as const,
  invitations: () => [...identityKeys.all, 'invitations'] as const,
  userInvitations: () => [...identityKeys.invitations(), 'user'] as const,
  organizationInvitations: () => [...identityKeys.invitations(), 'organization'] as const,
  /** LIF-01-T21 transfer worklist a departing member must clear. */
  outstandingResponsibilities: () =>
    [...identityKeys.all, 'outstanding-responsibilities'] as const,
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
  setup: () => [...dashboardKeys.all, 'setup-checklist'] as const,
  fleets: () => [...dashboardKeys.all, 'fleet'] as const,
  // Each range has its own infinite cache entry. Use `fleets()` when an
  // operation genuinely invalidates every range rather than the visible one.
  fleet: (timeRange = '30d') => [...dashboardKeys.fleets(), timeRange] as const,
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
  googlePerformanceLease: (
    propertyId: string,
    preset: string,
    catalogVersion: string,
    viewEpoch: number,
    leaseRef: string,
  ) =>
    [
      ...dashboardKeys.googlePerformance(propertyId, preset, catalogVersion, viewEpoch),
      'authorization-lease',
      leaseRef,
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
  detail: (propertyId: string, goalId: string) =>
    [...goalKeys.all, 'detail', propertyId, goalId] as const,
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

// ── Portals (detail + links + groups) ────────────────────────────────────
export const portalKeys = {
  all: ['portals'] as const,
  list: (propertyId: string) => [...portalKeys.all, 'list', propertyId] as const,
  detail: (portalId: string) => [...portalKeys.all, 'detail', portalId] as const,
  links: (portalId: string) => [...portalKeys.detail(portalId), 'links'] as const,
  responsibleManagers: (portalId: string) =>
    [...portalKeys.detail(portalId), 'responsible-managers'] as const,
  publicationHistory: (portalId: string) =>
    [...portalKeys.detail(portalId), 'publication-history'] as const,
  experience: (propertyId: string, portalId: string) =>
    [...portalKeys.detail(portalId), 'experience', propertyId] as const,
  approvedDestinations: (portalId: string) =>
    [...portalKeys.detail(portalId), 'approved-destinations'] as const,
  groups: (propertyId: string) => [...portalKeys.all, 'groups', propertyId] as const,
  goalSubjects: (propertyId: string) =>
    [...portalKeys.all, 'goal-subjects', propertyId] as const,
  goalSubjectNames: (propertyId: string) =>
    [...portalKeys.goalSubjects(propertyId), 'names'] as const,
  forProperty: (propertyId: string) =>
    [...portalKeys.all, 'property', propertyId] as const,
  forPropertyPortal: (propertyId: string, portalId: string) =>
    [...portalKeys.forProperty(propertyId), 'portal', portalId] as const,
  analyticsRoot: (propertyId: string, portalId: string) =>
    [...portalKeys.forPropertyPortal(propertyId, portalId), 'analytics'] as const,
  analytics: (propertyId: string, portalId: string, timeRange: string) =>
    [...portalKeys.analyticsRoot(propertyId, portalId), timeRange] as const,
}

// ── Integrations (Google connections + bounded import content) ───────────
export const integrationKeys = {
  all: ['integrations'] as const,
  connections: () => [...integrationKeys.all, 'connections'] as const,
  googleImportContent: () => [...integrationKeys.all, 'google-import-content'] as const,
  googleImportAccounts: (
    organizationId: string,
    connectionId: string,
    viewEpoch: number,
  ) =>
    [
      ...integrationKeys.googleImportContent(),
      organizationId,
      connectionId,
      'accounts',
      viewEpoch,
    ] as const,
  googleImportCandidates: (
    organizationId: string,
    connectionId: string,
    accountRef: string | null,
    viewEpoch: number,
  ) =>
    [
      ...integrationKeys.googleImportContent(),
      organizationId,
      connectionId,
      'candidates',
      accountRef,
      viewEpoch,
    ] as const,
  googleImportLease: (
    organizationId: string,
    connectionId: string,
    leaseRef: string,
    viewEpoch: number,
  ) =>
    [
      ...integrationKeys.googleImportContent(),
      organizationId,
      connectionId,
      'lease',
      leaseRef,
      viewEpoch,
    ] as const,
  import: (importId: string) => [...integrationKeys.all, 'import', importId] as const,
}

// ── Guest / public portal ────────────────────────────────────────────────
export const guestKeys = {
  all: ['guest'] as const,
  publicPortal: (args: Readonly<Record<string, unknown>>) =>
    [...guestKeys.all, 'public-portal', args] as const,
}
