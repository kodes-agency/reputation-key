// Saving the Manage access sheet. Grants and revokes go to the one access
// command (atomic, one fact, the member is told). Responsibility is the
// Property's own Responsible managers command, which replaces a whole list at a
// revision, so each changed Property is read fresh and only this member is added
// or removed. Responsibility needs the grant, so it runs after the access
// command, and its failures are returned rather than thrown: the access change
// has already committed and is the part that matters.

import type { SaveMemberAccessInput } from '#/components/features/identity'

type Ids = ReadonlyArray<string>

export type SaveMemberAccessResult = Readonly<{
  grantedPropertyIds: Ids
  revokedPropertyIds: Ids
  /** Properties whose Responsible manager change could not be saved. */
  responsibilityFailedPropertyIds: Ids
}>

/** The server functions the save sequence calls, injected so it can be tested. */
export type SaveMemberAccessDeps = Readonly<{
  setAccess: (input: {
    data: { memberId: string; grantPropertyIds: string[]; revokePropertyIds: string[] }
  }) => Promise<{ grantedPropertyIds: Ids; revokedPropertyIds: Ids }>
  listResponsible: (input: {
    data: { propertyId: string }
  }) => Promise<{ assignments: ReadonlyArray<{ userId: string }>; revision: number }>
  updateResponsible: (input: {
    data: { propertyId: string; managerUserIds: string[]; expectedRevision: number }
  }) => Promise<unknown>
}>

export function createSaveMemberAccess(deps: SaveMemberAccessDeps) {
  const setResponsible = async (
    propertyId: string,
    userId: string,
    shouldBeResponsible: boolean,
  ): Promise<void> => {
    const current = await deps.listResponsible({ data: { propertyId } })
    const others = current.assignments
      .map((assignment) => assignment.userId)
      .filter((id) => id !== userId)
    await deps.updateResponsible({
      data: {
        propertyId,
        managerUserIds: shouldBeResponsible ? [...others, userId] : others,
        expectedRevision: current.revision,
      },
    })
  }

  return async (input: SaveMemberAccessInput): Promise<SaveMemberAccessResult> => {
    const hasAccessChange =
      input.grantPropertyIds.length > 0 || input.revokePropertyIds.length > 0
    const applied = hasAccessChange
      ? await deps.setAccess({
          data: {
            memberId: input.memberId,
            grantPropertyIds: [...input.grantPropertyIds],
            revokePropertyIds: [...input.revokePropertyIds],
          },
        })
      : { grantedPropertyIds: [], revokedPropertyIds: [] }

    const changes = [
      ...input.responsibleOnPropertyIds.map((id) => ({ id, responsible: true })),
      ...input.responsibleOffPropertyIds.map((id) => ({ id, responsible: false })),
    ]
    const failed: string[] = []
    // One Property at a time: each has its own revision to read and replace.
    for (const change of changes) {
      try {
        await setResponsible(change.id, input.userId, change.responsible)
      } catch {
        failed.push(change.id)
      }
    }

    return {
      grantedPropertyIds: applied.grantedPropertyIds,
      revokedPropertyIds: applied.revokedPropertyIds,
      responsibilityFailedPropertyIds: failed,
    }
  }
}
