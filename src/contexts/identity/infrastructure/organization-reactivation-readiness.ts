// LIF-01-T18 — the production readiness evaluation for explicit reactivation.
//
// Two of the five checks are answerable from facts this deployable already
// owns, so they are wired here rather than injected:
//
//   * `data_cell_health` — beta is exactly ONE logical US Data Cell
//     (`cell-us`). "Healthy" therefore means the serving process resolves that
//     cell and the cell accepts work; a reactivation admitted from a cell that
//     is not accepting work would hand the tenant back a workspace whose jobs
//     cannot run.
//   * `schedule_quarantine_cleared` — the lifecycle, import, sync and
//     notification schedules are declared in the shared job catalogue, and
//     LIF-01 deliberately keeps the lifecycle families QUARANTINED. Reading
//     the catalogue is the honest answer: while any of them is a safety no-op,
//     a reactivated Organization would have no worker able to serve it, so
//     reactivation stays fenced by the same containment as the rest of the
//     destructive lifecycle.
//
// The other three ask questions owned by other contexts (Property
// responsibility, Integration's Google authorization, Portal republication).
// Identity must not read foreign tables (`src/contexts/CONTEXT.md`), so each
// arrives as an injected content-free probe — the same shape ExecutionPolicy
// uses for `admitPropertyExecution`.

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
export const REACTIVATION_REQUIRED_SCHEDULES = Object.freeze([
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
  /** Fresh, content-free Data Cell admission for the serving cell. */
  admitDataCell: () => Promise<Readonly<{ accepting: boolean; detailCode: string }>>
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
    data_cell_health: async () => {
      const decision = await deps.admitDataCell()
      return { satisfied: decision.accepting, detailCode: decision.detailCode }
    },
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
