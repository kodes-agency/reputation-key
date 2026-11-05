// Keep browser subject comparisons apart from the first-paint Program module.

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
