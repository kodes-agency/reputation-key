// Preserve old New goal links by opening the matching add-sheet step. Drop unrelated
// search keys; Property subjects return to the choice step.

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
