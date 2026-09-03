import { and, eq, gt, isNull, lte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portals,
  portalResponsibilities,
  staffParticipants,
  staffParticipations,
} from '#/shared/db/schema'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import {
  primaryStaffAttributionContains,
  type PrimaryStaffAttributionSnapshot,
} from '#/shared/domain/primary-staff-attribution'

export type ResolvePrimaryStaffAttributionInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  observedAt: Date
}>

export class PrimaryStaffAttributionCorruptionError extends Error {
  readonly code = 'primary_staff_attribution_corrupt'

  constructor() {
    super('Primary Staff attribution data is inconsistent')
    this.name = 'PrimaryStaffAttributionCorruptionError'
  }
}

export type PrimaryStaffAttributionRow = Readonly<{
  portalResponsibilityId: string
  organizationId: string
  propertyId: string
  portalId: string
  staffParticipationId: string
  staffParticipantId: string | null
  responsibilityEffectiveFrom: Date
  responsibilityEffectiveTo: Date | null
  participationStartedAt: Date | null
  participationEndedAt: Date | null
  participantCreatedAt: Date | null
  participantArchivedAt: Date | null
  retainedPortalId: string | null
}>

/**
 * Decide from already-scoped retained rows. More than one candidate, broken
 * tenant joins, or lifecycle intervals that do not contain the observation
 * are corruption and fail closed rather than silently dropping attribution.
 */
export function decidePrimaryStaffAttribution(
  rows: readonly PrimaryStaffAttributionRow[],
  observedAt: Date,
): PrimaryStaffAttributionSnapshot | null {
  if (rows.length === 0) return null
  if (rows.length !== 1 || Number.isNaN(observedAt.getTime())) {
    throw new PrimaryStaffAttributionCorruptionError()
  }

  const row = rows[0]
  if (
    !row.staffParticipantId ||
    !row.retainedPortalId ||
    !row.participationStartedAt ||
    !row.participantCreatedAt ||
    !primaryStaffAttributionContains(
      {
        staffParticipantId: row.staffParticipantId,
        staffParticipationId: row.staffParticipationId,
        portalResponsibilityId: row.portalResponsibilityId,
        effectiveFrom: row.responsibilityEffectiveFrom,
        effectiveTo: row.responsibilityEffectiveTo,
      },
      observedAt,
    ) ||
    row.participationStartedAt > observedAt ||
    (row.participationEndedAt !== null && row.participationEndedAt <= observedAt) ||
    row.participantCreatedAt > observedAt ||
    (row.participantArchivedAt !== null && row.participantArchivedAt <= observedAt)
  ) {
    throw new PrimaryStaffAttributionCorruptionError()
  }

  return {
    staffParticipantId: row.staffParticipantId,
    staffParticipationId: row.staffParticipationId,
    portalResponsibilityId: row.portalResponsibilityId,
    effectiveFrom: row.responsibilityEffectiveFrom,
    effectiveTo: row.responsibilityEffectiveTo,
  }
}

export const createPrimaryStaffAttributionResolver = (db: Database) =>
  async function resolvePrimaryStaffAttribution(
    input: ResolvePrimaryStaffAttributionInput,
  ): Promise<PrimaryStaffAttributionSnapshot | null> {
    if (Number.isNaN(input.observedAt.getTime())) {
      throw new PrimaryStaffAttributionCorruptionError()
    }

    // Limit two is intentional: the decision only needs to distinguish zero,
    // exactly one, and overlap/corruption while bounding a corrupt read.
    const rows = await db
      .select({
        portalResponsibilityId: portalResponsibilities.id,
        organizationId: portalResponsibilities.organizationId,
        propertyId: portalResponsibilities.propertyId,
        portalId: portalResponsibilities.portalId,
        staffParticipationId: portalResponsibilities.staffParticipationId,
        staffParticipantId: staffParticipations.staffParticipantId,
        responsibilityEffectiveFrom: portalResponsibilities.effectiveFrom,
        responsibilityEffectiveTo: portalResponsibilities.effectiveTo,
        participationStartedAt: staffParticipations.startedAt,
        participationEndedAt: staffParticipations.endedAt,
        participantCreatedAt: staffParticipants.createdAt,
        participantArchivedAt: staffParticipants.archivedAt,
        retainedPortalId: portals.id,
      })
      .from(portalResponsibilities)
      .leftJoin(
        portals,
        and(
          eq(portals.organizationId, portalResponsibilities.organizationId),
          eq(portals.propertyId, portalResponsibilities.propertyId),
          eq(portals.id, portalResponsibilities.portalId),
        ),
      )
      .leftJoin(
        staffParticipations,
        and(
          eq(staffParticipations.organizationId, portalResponsibilities.organizationId),
          eq(staffParticipations.propertyId, portalResponsibilities.propertyId),
          eq(staffParticipations.id, portalResponsibilities.staffParticipationId),
        ),
      )
      .leftJoin(
        staffParticipants,
        and(
          eq(staffParticipants.organizationId, portalResponsibilities.organizationId),
          eq(staffParticipants.id, staffParticipations.staffParticipantId),
        ),
      )
      .where(
        and(
          eq(portalResponsibilities.organizationId, input.organizationId),
          eq(portalResponsibilities.propertyId, input.propertyId),
          eq(portalResponsibilities.portalId, input.portalId),
          eq(portalResponsibilities.kind, 'primary'),
          lte(portalResponsibilities.effectiveFrom, input.observedAt),
          or(
            isNull(portalResponsibilities.effectiveTo),
            gt(portalResponsibilities.effectiveTo, input.observedAt),
          ),
        ),
      )
      .limit(2)

    return decidePrimaryStaffAttribution(rows, input.observedAt)
  }
