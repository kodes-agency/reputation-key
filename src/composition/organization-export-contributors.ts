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
