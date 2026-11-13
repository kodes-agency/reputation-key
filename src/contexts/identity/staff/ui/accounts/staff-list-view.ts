import type { StaffMember } from './staff-account-view'
export const notJoined = (member: StaffMember) => member.access !== 'active'
export function staffInNameOrder(members: readonly StaffMember[]) {
  return [...members].sort(
    (a, b) =>
      Number(notJoined(b)) - Number(notJoined(a)) ||
      a.displayName.localeCompare(b.displayName) ||
      a.participationId.localeCompare(b.participationId),
  )
}
export function filterStaff(
  members: readonly StaffMember[],
  joined: string,
  group: string,
) {
  return staffInNameOrder(members).filter(
    (person) =>
      (joined !== 'pending' || notJoined(person)) &&
      (group === 'all' ||
        (group === 'none' ? !person.group : person.group?.id === group)),
  )
}

export function staffRosterSummary(members: readonly StaffMember[]): string {
  const count = members.length
  const pending = members.filter(notJoined).length
  const people = `${count} ${count === 1 ? 'person' : 'people'}`
  if (!pending) return people
  return `${people}, ${pending} ${pending === 1 ? "hasn't" : "haven't"} joined yet`
}
