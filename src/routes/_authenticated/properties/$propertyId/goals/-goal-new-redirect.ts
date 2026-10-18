// Where an old New goal address goes now (PLAN PG-20): "Add a portal goal" on
// the Monthly portal goal's page, opened on the step the address asked for.
//
//   /goals/new                           → ?add=choose
//   /goals/new?mode=several              → ?add=each
//   /goals/new?subject=portal:<id>       → ?add=portal&subject=portal:<id>
//   /goals/new?subject=portal_group:<id> → ?add=group&subject=portal_group:<id>
//   /goals/new?subject=property:<id>     → ?add=choose
//
// Every other key is dropped. Pure: the route's `beforeLoad` calls it with the
// address as the router read it, so nothing of the old page reaches first paint.

type Address = Readonly<{
  add: 'choose' | 'each' | 'portal' | 'group'
  subject?: string
}>

/** The longest subject the goal page reads. */
const MAX_SUBJECT = 100

const subjectOf = (raw: unknown, kind: 'portal' | 'portal_group'): string | null =>
  typeof raw === 'string' &&
  raw.length <= MAX_SUBJECT &&
  raw.startsWith(`${kind}:`) &&
  raw.length > kind.length + 1
    ? raw
    : null

export function goalNewRedirect(search: Readonly<Record<string, unknown>>): Address {
  if (search.mode === 'several') return { add: 'each' }
  const portal = subjectOf(search.subject, 'portal')
  if (portal !== null) return { add: 'portal', subject: portal }
  const group = subjectOf(search.subject, 'portal_group')
  if (group !== null) return { add: 'group', subject: group }
  return { add: 'choose' }
}
