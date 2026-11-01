import { getContainer } from '#/composition'
import { resolveStaff } from '#/shared/auth/staff-resolver'
import { throwAuthError } from '#/shared/auth/auth-errors'
import {
  requireOwnStaffParticipation,
  requireStaffSelfPerson,
} from '#/contexts/identity/application/public-api'

export async function resolveStaffSelfContext(headers: Headers) {
  const ctx = await resolveStaff(headers)
  const found = await getContainer().identityPublicApi.staffSelf.find(
    ctx.organizationId,
    ctx.userId,
  )
  if (!found || !found.participations.length)
    throwAuthError('forbidden', 'This account has no active personal Portal')
  const person = requireStaffSelfPerson(found)
  return { ctx, person }
}

export const requireOwnParticipation: typeof requireOwnStaffParticipation = (
  person,
  participationId,
) => {
  if (!person.participations.some((row) => row.participationId === participationId))
    throwAuthError('forbidden', 'Choose one of your own staff Properties')
  return requireOwnStaffParticipation(person, participationId)
}
