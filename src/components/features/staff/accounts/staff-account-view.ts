import type { listStaffMembers } from '#/contexts/identity/server/staff-accounts'
export type StaffMember = Awaited<ReturnType<typeof listStaffMembers>>['members'][number]
export const staffAccessLine = (access: StaffMember['access']): string =>
  ({
    active: 'Signed in',
    invited: 'Invited, not signed in yet',
    invite_expired: 'Invitation expired',
    failed: "Setup didn't finish",
  })[access]
export function staffMemberMenu(
  member: Pick<StaffMember, 'access' | 'step' | 'portalId'>,
  access: Readonly<{ invite: boolean; remove: boolean }>,
) {
  return [
    ...(member.portalId ? ['code' as const] : []),
    ...(access.invite && member.step !== 'removal' ? ['rename' as const] : []),
    ...(access.invite &&
    (member.access === 'invited' || member.access === 'invite_expired')
      ? ['resend' as const]
      : []),
    ...(access.remove ? ['remove' as const] : []),
  ]
}
export function staffRemovalWords(
  member: Pick<StaffMember, 'access' | 'displayName'>,
  endsSignIn: boolean,
) {
  const pending = member.access === 'invited' || member.access === 'invite_expired'
  return {
    title: pending
      ? `Cancel invitation for ${member.displayName}?`
      : `Remove ${member.displayName}?`,
    confirmLabel: pending ? 'Cancel invitation' : 'Remove',
    description: `Their code stops working and their portal is archived. Their past results stay in your totals.${endsSignIn ? ' Their sign-in ends.' : ''}`,
  }
}

export const staffRepairAction = (member: Pick<StaffMember, 'step'>): 'remove' | 'add' =>
  member.step === 'removal' ? 'remove' : 'add'
