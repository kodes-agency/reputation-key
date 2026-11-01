import type { StaffSelfPerson } from './ports/staff-self-reader.port'
import { staffAccountError } from '../domain/staff-account'

export function requireOwnStaffParticipation(
  person: StaffSelfPerson,
  participationId: string,
) {
  const own = person.participations.find((row) => row.participationId === participationId)
  if (!own)
    throw staffAccountError('forbidden', 'Choose one of your own staff Properties')
  return own
}

export function requireStaffSelfPerson(person: StaffSelfPerson | null) {
  if (!person || person.participations.length === 0)
    throw staffAccountError('forbidden', 'This account has no active personal Portal')
  return person
}
