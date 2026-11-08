import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

type StaffAttributionColumns = Readonly<{
  attributedStaffParticipantId: string | null
  attributedStaffParticipationId: string | null
  attributionResponsibilityId: string | null
  staffAttributionEffectiveFrom: Date | null
  staffAttributionEffectiveTo: Date | null
}>

export const staffAttributionFromColumns = (
  row: Partial<StaffAttributionColumns>,
): PrimaryStaffAttributionSnapshot | null =>
  row.attributedStaffParticipantId &&
  row.attributedStaffParticipationId &&
  row.attributionResponsibilityId &&
  row.staffAttributionEffectiveFrom
    ? {
        staffParticipantId: row.attributedStaffParticipantId,
        staffParticipationId: row.attributedStaffParticipationId,
        portalResponsibilityId: row.attributionResponsibilityId,
        effectiveFrom: row.staffAttributionEffectiveFrom,
        effectiveTo: row.staffAttributionEffectiveTo ?? null,
      }
    : null

export const staffAttributionColumns = (
  attribution: PrimaryStaffAttributionSnapshot | null,
): StaffAttributionColumns => ({
  attributedStaffParticipantId: attribution?.staffParticipantId ?? null,
  attributedStaffParticipationId: attribution?.staffParticipationId ?? null,
  attributionResponsibilityId: attribution?.portalResponsibilityId ?? null,
  staffAttributionEffectiveFrom: attribution?.effectiveFrom ?? null,
  staffAttributionEffectiveTo: attribution?.effectiveTo ?? null,
})
