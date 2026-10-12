// What a goal is set for, and how one subject is told from another.
//
// Its own module, apart from the Program's other rules, because the new-goal
// form compares subjects in the browser: the Program module is part of the
// first-paint bundle (the command DTO imports it), and this must not add to it.

export type GoalSubject =
  | Readonly<{ kind: 'property'; propertyId: string }>
  | Readonly<{ kind: 'portal_group'; portalGroupId: string }>
  | Readonly<{ kind: 'portal'; portalId: string }>

export function goalSubjectIdentity(subject: GoalSubject): string {
  switch (subject.kind) {
    case 'property':
      return `property:${subject.propertyId}`
    case 'portal_group':
      return `portal_group:${subject.portalGroupId}`
    case 'portal':
      return `portal:${subject.portalId}`
  }
}
