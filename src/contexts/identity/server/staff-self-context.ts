import { resolveStaff } from '#/shared/auth/staff-resolver'
import { throwAuthError } from '#/shared/auth/auth-errors'
import { getContainer } from '#/composition'
import type { StaffSelfPerson } from '../application/ports/staff-self-reader.port'

export function requireOwnParticipation(
  person: StaffSelfPerson,
  participationId: string,
) {
  const own = person.participations.find((row) => row.participationId === participationId)
  if (!own) throwAuthError('forbidden', 'Choose one of your own staff Properties')
  return own
}

export async function resolveStaffSelfContext(headers: Headers) {
  const ctx = await resolveStaff(headers)
  const person = await getContainer().identityPublicApi.staffSelf.find(
    ctx.organizationId,
    ctx.userId,
  )
  if (!person || person.participations.length === 0)
    throwAuthError('forbidden', 'This account has no active personal Portal')
  return { ctx, person }
}
