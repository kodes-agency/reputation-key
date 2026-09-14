import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import { personInitials } from './person-initials'

export type InboxAssignmentOption = Readonly<{
  userId: string
  name: string
}>

export type InboxOwnerView = Readonly<{
  label: string
  initials: string | null
  isAssigned: boolean
}>

/** Resolve opaque assignment ids without ever leaking the id into the UI. */
export function resolveInboxOwner(
  assignedTo: string | null,
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>,
  currentUser?: InboxCurrentUser,
): InboxOwnerView {
  if (assignedTo === null) {
    return { label: 'Unassigned', initials: null, isAssigned: false }
  }

  const listedName =
    assignmentOptions.find((option) => option.userId === assignedTo)?.name.trim() || null
  if (currentUser !== undefined && assignedTo === currentUser.id) {
    return {
      label: 'You',
      initials: personInitials(currentUser.name) ?? personInitials(listedName),
      isAssigned: true,
    }
  }
  if (listedName === null) {
    return { label: 'Assigned', initials: null, isAssigned: true }
  }
  return {
    label: listedName,
    initials: personInitials(listedName),
    isAssigned: true,
  }
}
