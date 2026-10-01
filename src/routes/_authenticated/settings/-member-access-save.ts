// Saving the Manage access sheet. Grants and revokes go to the one access
// command (atomic, one fact, the member is told). Responsibility is the
// Property's own Responsible managers command, which replaces a whole list at a
// revision, so each changed Property is read fresh and only this member is added
// or removed. Responsibility needs the grant, so it runs after the access
// command, and its failures are returned rather than thrown: the access change
// has already committed and is the part that matters. Each failure keeps its
// error code, so the caller can say why, and is handed to monitoring.

import type { SaveMemberAccessInput } from '#/components/features/identity'
import { isServerFunctionError } from '#/shared/auth/server-function-error'

type Ids = ReadonlyArray<string>

/** Why one Property's Responsible manager change was not saved. */
export type ResponsibilityFailure = Readonly<{
  propertyId: string
  /** The server's error code, or `unknown` for a failure that carried none. */
  code: string
}>

export type SaveMemberAccessResult = Readonly<{
  grantedPropertyIds: Ids
  revokedPropertyIds: Ids
  /** Properties whose Responsible manager change could not be saved, and why. */
  responsibilityFailures: ReadonlyArray<ResponsibilityFailure>
}>

const UNKNOWN_FAILURE = 'unknown'
const REVISION_CONFLICT = 'revision_conflict'

function failureCode(error: unknown): string {
  return isServerFunctionError(error) ? error.code : UNKNOWN_FAILURE
}

/** A short clause for a failure code, to follow the Property's name in a toast. */
export function responsibilityFailureReason(code: string): string {
  switch (code) {
    case REVISION_CONFLICT:
      return 'its Responsible managers changed while you were saving'
    case 'forbidden':
      return 'you cannot change its Responsible managers'
    case 'responsible_manager_ineligible':
      return 'they cannot be its Responsible manager'
    case 'property_not_found':
    case 'property_not_active':
      return 'it is no longer available'
    default:
      return 'something went wrong'
  }
}

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
  /** Hands a failure to monitoring; the caller decides which ones are worth it. */
  reportFailure: (error: unknown) => void
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

  // The list is replaced at a revision, so another admin saving first is a
  // conflict. Reading it again and replacing only this member is safe, so one
  // retry settles the common race; a second conflict is reported.
  const setResponsibleOnce = async (
    propertyId: string,
    userId: string,
    shouldBeResponsible: boolean,
  ): Promise<void> => {
    try {
      await setResponsible(propertyId, userId, shouldBeResponsible)
    } catch (error) {
      if (failureCode(error) !== REVISION_CONFLICT) throw error
      await setResponsible(propertyId, userId, shouldBeResponsible)
    }
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
    const failures: ResponsibilityFailure[] = []
    // One Property at a time: each has its own revision to read and replace.
    for (const change of changes) {
      try {
        await setResponsibleOnce(change.id, input.userId, change.responsible)
      } catch (error) {
        failures.push({ propertyId: change.id, code: failureCode(error) })
        deps.reportFailure(error)
      }
    }

    return {
      grantedPropertyIds: applied.grantedPropertyIds,
      revokedPropertyIds: applied.revokedPropertyIds,
      responsibilityFailures: failures,
    }
  }
}
