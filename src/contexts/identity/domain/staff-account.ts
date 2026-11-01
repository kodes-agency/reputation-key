import { createErrorFactory } from '#/shared/domain/errors'

export const STAFF_NOTICE_VERSION = 'staff-notice-2026-11-01.v1'
export const STAFF_ONBOARDING_STEPS = [
  'person',
  'portal',
  'responsibility',
  'code',
  'publication',
  'access',
] as const
export type StaffOnboardingStep = (typeof STAFF_ONBOARDING_STEPS)[number]
export type StaffRowCode =
  | 'invalid_email'
  | 'name_required'
  | 'duplicate_in_batch'
  | 'already_staff_here'
  | 'already_invited'
  | 'other_organization'
export type StaffAccountErrorCode =
  | StaffRowCode
  | 'forbidden'
  | 'operation_conflict'
  | 'participation_not_found'
  | 'notice_version_changed'
  | 'colleague_list_disabled'
  | 'rate_limited'
export const staffAccountError = createErrorFactory<
  'StaffAccountError',
  StaffAccountErrorCode
>('StaffAccountError')
export type StaffOnboarding = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  email: string | null
  displayName: string | null
  sourcePortalId: string | null
  portalGroupId: string | null
  requestedBy: string
  status: 'running' | 'failed' | 'done' | 'cancelled'
  step: StaffOnboardingStep
  staffParticipantId: string
  staffParticipationId: string
  portalId: string
  invitationId: string
  failureCode: string | null
}>
export type StaffOnboardingResult = Readonly<{
  operationId: string
  participationId: string
  portalId: string
  status: StaffOnboarding['status']
  step: StaffOnboardingStep
  code: string | null
}>
export const staffOnboardingResult = (row: StaffOnboarding): StaffOnboardingResult => ({
  operationId: row.id,
  participationId: row.staffParticipationId,
  portalId: row.portalId,
  status: row.status,
  step: row.step,
  code: row.failureCode,
})
