// LIF-01-T18 — the production readiness evaluation for explicit reactivation.
//
// The schedule check is answerable from facts this deployable already owns,
// so it is wired here rather than injected. Lifecycle advances its own state;
// import and sync keep provider content current; notification families tell
// the tenant about changes. While any required family is quarantined, a
// reactivated Organization would have no worker able to serve it.
//
// The other three checks ask questions owned by other contexts (Property
// responsibility, Integration's Google authorization, Portal republication).
// Identity must not read foreign tables (`src/contexts/CONTEXT.md`), so each
// arrives as an injected content-free probe.

import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  createOrganizationReactivationReadiness,
  type OrganizationReactivationProbe,
  type OrganizationReactivationReadinessPort,
} from '../application/ports/organization-reactivation-readiness.port'

/**
 * The schedules a reactivated Organization immediately depends on.
 *
 * Lifecycle advances its own state, import and sync keep provider content
 * current, and the two notification families are how the tenant is told
 * anything at all. A quarantined member of this set means the workspace would
 * come back inert.
 */
const REACTIVATION_REQUIRED_SCHEDULES = Object.freeze([
  'advance-organization-lifecycle',
  'import-gbp-property-item-v2',
  'sync-property-reviews',
  'urgent-email',
  'digest-notification',
])

/** Job families that are missing from, or quarantined in, the catalogue. */
export function quarantinedReactivationSchedules(): readonly string[] {
  return REACTIVATION_REQUIRED_SCHEDULES.filter((jobName) => {
    const row = JOB_FAMILY_ROWS.find((candidate) => candidate.jobName === jobName)
    return row === undefined || row.registration !== 'enabled'
  })
}

export type OrganizationReactivationReadinessDeps = Readonly<{
  /**
   * Property: does EVERY Property carry an eligible CURRENT Responsible
   * Manager? This is the same question `restoreProperty` asks per Property,
   * asked once for the whole Organization.
   */
  hasEligibleResponsibleManagers: OrganizationReactivationProbe
  /**
   * Integration: is there a FRESH Google authorization? A credential stored
   * before the closure is not evidence of current consent, so this probe must
   * answer on authorization recency, never on row presence.
   */
  hasFreshGoogleAuthorization: OrganizationReactivationProbe
  /**
   * Portal: was at least one Portal DELIBERATELY re-pointed at the immutable
   * snapshot Wave 6's contributor retained? The probe observes the new
   * activation; it must never create one.
   */
  hasDeliberatePortalReactivation: OrganizationReactivationProbe
}>

export const createDefaultOrganizationReactivationReadiness = (
  deps: OrganizationReactivationReadinessDeps,
): OrganizationReactivationReadinessPort =>
  createOrganizationReactivationReadiness({
    responsible_manager: deps.hasEligibleResponsibleManagers,
    google_authorization: deps.hasFreshGoogleAuthorization,
    portal_reactivation: deps.hasDeliberatePortalReactivation,
    schedule_quarantine_cleared: async () => {
      const quarantined = quarantinedReactivationSchedules()
      return {
        satisfied: quarantined.length === 0,
        // Job names are catalogue identifiers, not tenant content.
        detailCode:
          quarantined.length === 0
            ? 'schedules_enabled'
            : `quarantined:${quarantined.join('|')}`,
      }
    },
  })
