import { getContainer } from '#/composition'
import { resolveStaff } from '#/shared/auth/staff-resolver'
import { throwAuthError } from '#/shared/auth/auth-errors'

export async function resolveStaffSelfContext(headers: Headers) {
  const ctx = await resolveStaff(headers)
  const person = await getContainer().identityPublicApi.staffSelf.find(
    ctx.organizationId,
    ctx.userId,
  )
  if (!person || !person.participations.length)
    throwAuthError('forbidden', 'This account has no active personal Portal')
  return { ctx, person }
}

export function requireOwnParticipation<T extends { participationId: string }>(
  person: Readonly<{ participations: ReadonlyArray<T> }>,
  participationId: string,
): T {
  const own = person.participations.find((row) => row.participationId === participationId)
  if (!own) throwAuthError('forbidden', 'Choose one of your own staff Properties')
  return own
}
