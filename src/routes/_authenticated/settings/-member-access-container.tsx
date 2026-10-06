// Loads and saves one manager's access for the Members page's Manage access
// sheet: which of the member's properties they are a Responsible manager of
// (one read per granted property the checklist lists, only while the sheet is
// open), and the save sequence. The sheet itself is presentation, and it keeps
// its own baseline, so these reads moving under an open sheet change nothing
// the person is editing.

import { useMemo } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  MemberAccessSheet,
  joinNames,
  type MemberAccessTarget,
  type PropertyRef,
  type ResponsibilityState,
  type SaveMemberAccessInput,
  grantsOnListedProperties,
} from '#/components/features/identity'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from '#/contexts/property/server/property-responsible-managers'
import { setMemberPropertyAccess } from '#/contexts/identity/server/organizations'
import { responsibleManagersQuery } from '#/routes/_authenticated/properties/$propertyId/-settings-queries'
import { identityKeys, propertyKeys } from '#/shared/queries/query-keys'
import {
  createSaveMemberAccess,
  responsibilityFailureReason,
  type SaveMemberAccessResult,
} from './-member-access-save'

type Props = Readonly<{
  member: MemberAccessTarget | null
  onClose: () => void
  properties: ReadonlyArray<PropertyRef>
  /** userId → the member's active grants, from the Organization's access read. */
  propertyIdsByUser: ReadonlyMap<string, ReadonlyArray<string>>
  canRemove: boolean
  removeMemberAction: Action<{ data: { memberId: string } }>
  /**
   * Hands a responsibility failure to monitoring. A refusal (a 4xx) is a
   * product outcome the toast already explains, so the router's reporter drops
   * it; anything else, a network failure included, is worth seeing. Injected
   * rather than imported: see `reportUnexpectedFailure` in router.tsx.
   */
  reportFailure: (error: unknown) => void
}>

export function MemberAccessContainer({
  member,
  onClose,
  properties,
  propertyIdsByUser,
  canRemove,
  removeMemberAction,
  reportFailure,
}: Props) {
  const queryClient = useQueryClient()
  const saveMemberAccess = useMemo(
    () =>
      createSaveMemberAccess({
        setAccess: setMemberPropertyAccess,
        listResponsible: listPropertyResponsibleManagers,
        updateResponsible: updatePropertyResponsibleManagers,
        reportFailure,
      }),
    [reportFailure],
  )
  const currentPropertyIds = member ? (propertyIdsByUser.get(member.userId) ?? []) : []

  // Responsibility is read per Property the member already holds, and only for
  // one the checklist lists: that is all the sheet can change, and each read is
  // a request. A Property they are about to be granted cannot have them as a
  // Responsible manager yet.
  const readPropertyIds = grantsOnListedProperties(
    currentPropertyIds,
    properties.map((property) => property.id),
  )
  const responsibleReads = useQueries({
    queries: readPropertyIds.map((propertyId) => ({
      ...responsibleManagersQuery(propertyId),
      enabled: member !== null,
    })),
  })
  const responsibility: ResponsibilityState = responsibleReads.some(
    (read) => read.isError,
  )
    ? { status: 'unavailable' }
    : responsibleReads.some((read) => read.isPending)
      ? { status: 'loading' }
      : {
          status: 'ready',
          responsibleIds: readPropertyIds.filter((_, index) =>
            responsibleReads[index]?.data?.assignments.some(
              (assignment) => assignment.userId === member?.userId,
            ),
          ),
        }

  const nameOf = (propertyId: string) =>
    properties.find((property) => property.id === propertyId)?.name ?? propertyId

  // The sheet shows a refusal inline, so this mutation does not also toast it.
  const saveAction = useActionMutation<SaveMemberAccessInput, SaveMemberAccessResult>(
    saveMemberAccess,
    {
      invalidateKeys: [identityKeys.members()],
      onSuccess: async (result, input) => {
        const touched = new Set([
          ...result.grantedPropertyIds,
          ...result.revokedPropertyIds,
          ...input.responsibleOnPropertyIds,
          ...input.responsibleOffPropertyIds,
        ])
        await Promise.all(
          [...touched].map((propertyId) =>
            queryClient.invalidateQueries({
              queryKey: propertyKeys.responsibleManagers(propertyId),
            }),
          ),
        )
        if (result.responsibilityFailures.length > 0) {
          toast.warning(
            `Access saved, but responsibility could not be updated for ${joinNames(
              result.responsibilityFailures.map(
                ({ propertyId, code }) =>
                  `${nameOf(propertyId)} (${responsibilityFailureReason(code)})`,
              ),
            )}. Set it from each property's Responsible managers settings.`,
          )
        } else {
          toast.success('Access updated')
        }
        onClose()
      },
    },
  )

  return (
    <MemberAccessSheet
      member={member}
      onClose={onClose}
      properties={properties}
      currentPropertyIds={currentPropertyIds}
      responsibility={responsibility}
      canRemove={canRemove}
      saveAction={saveAction}
      removeMemberAction={removeMemberAction}
    />
  )
}
