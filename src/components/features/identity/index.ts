// Identity feature — public API.
// Re-exports page-level components from each concept folder.
// Internal sub-components are not exported.

export { LoginForm } from './login/login-form'
export { RegisterForm } from './registration/register-form'
export { AcceptInvitationPage } from './registration/accept-invitation-page'
export { InvitationLinkPage } from './registration/invitation-link-page'
export { InvitationStateCard } from './registration/invitation-state-card'
export { InvitationSummary } from './registration/invitation-summary'
export type { InvitationLink } from './registration/invitation-link'
export { MemberTable } from './member-directory/member-table'
export type { MemberRow, PropertyRef } from './member-directory/member-table'
export { ChangeRoleDialog } from './member-directory/change-role-dialog'
export { MemberAccessSheet } from './member-directory/member-access-sheet'
export type {
  MemberAccessTarget,
  ResponsibilityState,
  SaveMemberAccessInput,
} from './member-directory/member-access-sheet'
export {
  grantsOnListedProperties,
  joinNames,
} from './member-directory/member-access-diff'
export {
  memberRowsWithProperties,
  propertyIdsByUser,
} from './member-directory/member-rows'
export { InviteMemberForm } from './member-directory/invite-member-form'
export { InvitationTable } from './member-directory/invitation-table'
export type { InvitationRow } from './member-directory/invitation-table'
export { ResetPasswordForm } from './reset-password/reset-password-form'
export { SetNewPasswordForm } from './reset-password/set-new-password-form'
export { ProfileSettingsPage } from './profile-settings-page'
export { SecuritySettingsForm } from './security-settings-form'
