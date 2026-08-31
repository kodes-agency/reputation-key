// LIF-01-T11 — the complete Organization Export contributor set.
//
// buildOrganizationExportBundle refuses a partial set by design: a missing
// contributor would make an incomplete archive look complete, and the whole
// point of the coverage report is that every context answers, including with
// `no_data`. So the set is assembled in one place where the count is visible
// and a test can pin it, rather than accumulated across seventeen build calls.
//
// Every contributor is a pure `(db) => contributor`. That is deliberate: it
// makes the set independent of context build order, which matters because
// Identity is constructed long before most of the contexts whose data it
// exports. Threading contributors out of built contexts would have re-created
// exactly the late-bound build-order cycle ARC-03-T9 removed.
//
// Identity is absent here on purpose. It supplies its own reviewed contributor
// inside its build, and rejects a supplied `identity` entry — one owner, one
// implementation.

import type { IdentityOrganizationLifecycleComposition } from '#/contexts/identity/build'
import type { OrganizationExportContributor } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createActivityOrganizationExportContributor } from '#/contexts/activity/infrastructure/adapters/activity-organization-export.adapter'
import { createAiOrganizationExportContributor } from '#/contexts/ai/infrastructure/adapters/ai-organization-export.adapter'
import { createBadgeOrganizationExportContributor } from '#/contexts/badge/infrastructure/adapters/badge-organization-export.adapter'
import { createDashboardOrganizationExportAdapter } from '#/contexts/dashboard/infrastructure/adapters/dashboard-organization-export.adapter'
import { createGoalOrganizationExportAdapter } from '#/contexts/goal/infrastructure/adapters/goal-organization-export.adapter'
import { createGuestOrganizationExportContributor } from '#/contexts/guest/infrastructure/adapters/guest-organization-export.adapter'
import { createInboxOrganizationExportContributor } from '#/contexts/inbox/infrastructure/adapters/inbox-organization-export.adapter'
import { createIntegrationOrganizationExportContributor } from '#/contexts/integration/infrastructure/adapters/integration-organization-export.adapter'
import { createLeaderboardOrganizationExportContributor } from '#/contexts/leaderboard/infrastructure/adapters/leaderboard-organization-export.adapter'
import { createMetricOrganizationExportAdapter } from '#/contexts/metric/infrastructure/adapters/metric-organization-export.adapter'
import { createNotificationOrganizationExportContributor } from '#/contexts/notification/infrastructure/adapters/notification-organization-export.adapter'
import { createPortalOrganizationExportContributor } from '#/contexts/portal/infrastructure/adapters/portal-organization-export.adapter'
import { createPropertyOrganizationExportContributor } from '#/contexts/property/infrastructure/adapters/property-organization-export.adapter'
import { createReviewOrganizationExportContributor } from '#/contexts/review/infrastructure/adapters/review-organization-export.adapter'
import { createStaffOrganizationExportContributor } from '#/contexts/staff/infrastructure/adapters/staff-organization-export.adapter'
import { createTeamOrganizationExportContributor } from '#/contexts/team/infrastructure/adapters/team-organization-export.adapter'
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import { createActivityOrganizationLifecycleContributor } from '#/contexts/activity/infrastructure/adapters/activity-organization-lifecycle.adapter'
import { createAiOrganizationLifecycleContributor } from '#/contexts/ai/infrastructure/adapters/ai-organization-lifecycle.adapter'
import { createBadgeOrganizationLifecycleContributor } from '#/contexts/badge/infrastructure/adapters/badge-organization-lifecycle.adapter'
import { createDashboardOrganizationLifecycleAdapter } from '#/contexts/dashboard/infrastructure/adapters/dashboard-organization-lifecycle.adapter'
import { createGoalOrganizationLifecycleAdapter } from '#/contexts/goal/infrastructure/adapters/goal-organization-lifecycle.adapter'
import { createGuestOrganizationLifecycleContributor } from '#/contexts/guest/infrastructure/adapters/guest-organization-lifecycle.adapter'
import { createInboxOrganizationLifecycleContributor } from '#/contexts/inbox/infrastructure/adapters/inbox-organization-lifecycle.adapter'
import { createLeaderboardOrganizationLifecycleContributor } from '#/contexts/leaderboard/infrastructure/adapters/leaderboard-organization-lifecycle.adapter'
import { createMetricOrganizationLifecycleAdapter } from '#/contexts/metric/infrastructure/adapters/metric-organization-lifecycle.adapter'
import { createNotificationOrganizationLifecycleContributor } from '#/contexts/notification/infrastructure/adapters/notification-organization-lifecycle.adapter'
import { createPortalOrganizationLifecycleContributor } from '#/contexts/portal/infrastructure/adapters/portal-organization-lifecycle.adapter'
import { createPropertyOrganizationLifecycleContributor } from '#/contexts/property/infrastructure/adapters/property-organization-lifecycle.adapter'
import { createReviewOrganizationLifecycleContributor } from '#/contexts/review/infrastructure/adapters/review-organization-lifecycle.adapter'
import { createStaffOrganizationLifecycleContributor } from '#/contexts/staff/infrastructure/adapters/staff-organization-lifecycle.adapter'
import { createTeamOrganizationLifecycleContributor } from '#/contexts/team/infrastructure/adapters/team-organization-lifecycle.adapter'
import type { Database } from '#/shared/db'

/** Identity supplies its own; these are the sixteen it composes with. */
export const NON_IDENTITY_EXPORT_CONTRIBUTOR_COUNT = 16

/**
 * Every non-Identity Organization Export contributor.
 *
 * Order does not affect the archive — the bundle builder sorts contributions
 * by context and entries by UTF-8 byte order — so this list is alphabetical to
 * keep a missing context easy to spot in review.
 */
export function buildOrganizationExportContributors(
  db: Database,
): readonly OrganizationExportContributor[] {
  return Object.freeze([
    createActivityOrganizationExportContributor(db),
    createAiOrganizationExportContributor(db),
    createBadgeOrganizationExportContributor(db),
    createDashboardOrganizationExportAdapter(db),
    createGoalOrganizationExportAdapter(db),
    createGuestOrganizationExportContributor(db),
    createInboxOrganizationExportContributor(db),
    createIntegrationOrganizationExportContributor(db),
    createLeaderboardOrganizationExportContributor(db),
    createMetricOrganizationExportAdapter(db),
    createNotificationOrganizationExportContributor(db),
    createPortalOrganizationExportContributor(db),
    createPropertyOrganizationExportContributor(db),
    createReviewOrganizationExportContributor(db),
    createStaffOrganizationExportContributor(db),
    createTeamOrganizationExportContributor(db),
  ])
}

/**
 * The Organization lifecycle bindings the root hands to Identity.
 *
 * The sixteen contributors are always composed, because a partial set is the
 * failure that would not announce itself: an archive missing one context still
 * opens and still looks complete. Composing them is not an activation —
 * Identity still refuses to construct the export service until storage, the
 * retrieval-secret binding and generation recovery are supplied, so all this
 * changes is that readiness reports the truth about coverage.
 *
 * A caller-supplied composition wins outright, so a fixture can substitute its
 * own set without fighting the default.
 */
export function composeOrganizationLifecycle(
  db: Database,
  supplied: IdentityOrganizationLifecycleComposition | undefined,
): IdentityOrganizationLifecycleComposition {
  return {
    exportContributors: buildOrganizationExportContributors(db),
    ...supplied,
  }
}

/**
 * Every non-Identity destructive lifecycle contributor.
 *
 * DELIBERATELY NOT COMPOSED INTO THE DEFAULT CONTAINER. Unlike the export set,
 * these three phases stop tenant effects and then irreversibly scrub tenant
 * content, so composing them by default would arm the coordinator. The program
 * holds destructive activation behind crash recovery, backup-erasure fencing
 * and counsel-approved retention — none of which is satisfied yet — so
 * `createContainer` supplies no lifecycle contributors and readiness reports
 * seventeen missing contexts, which is the honest state.
 *
 * The set exists here so it can be assembled once, proved complete by test, and
 * handed to an explicitly reviewed composition when those preconditions are
 * met. A reviewed composition passes the result as
 * `organizationLifecycle.lifecycleContributors`.
 *
 * Integration is the one contributor that is not a pure `(db)`: revoking Google
 * credentials and subscriptions needs the provider port its own build wires, so
 * the caller supplies it from the built Integration context.
 */
export function buildOrganizationLifecycleContributors(
  db: Database,
  integration: OrganizationLifecycleContributor,
): readonly OrganizationLifecycleContributor[] {
  if (integration.context !== 'integration') {
    throw new Error('Integration lifecycle contributor is misidentified')
  }
  return Object.freeze([
    createActivityOrganizationLifecycleContributor(db),
    createAiOrganizationLifecycleContributor(db),
    createBadgeOrganizationLifecycleContributor(db),
    createDashboardOrganizationLifecycleAdapter(db),
    createGoalOrganizationLifecycleAdapter(db),
    createGuestOrganizationLifecycleContributor(db),
    createInboxOrganizationLifecycleContributor(db),
    integration,
    createLeaderboardOrganizationLifecycleContributor(db),
    createMetricOrganizationLifecycleAdapter(db),
    createNotificationOrganizationLifecycleContributor(db),
    createPortalOrganizationLifecycleContributor(db),
    createPropertyOrganizationLifecycleContributor(db),
    createReviewOrganizationLifecycleContributor(db),
    createStaffOrganizationLifecycleContributor(db),
    createTeamOrganizationLifecycleContributor(db),
  ])
}
