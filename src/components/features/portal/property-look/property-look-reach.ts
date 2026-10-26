// Which parts of the Property look reach which portal (ADR 0070). A portal
// follows the look until an Account Admin gives it its own photo, colours, or name
// and logo, and each of the three is followed on its own. The Property look page
// has to say, per portal, what an edit there still reaches: the rail names the
// parts a portal has of its own, the status line counts only the portals the
// look still reaches, and the preview lays the draft over the parts the chosen
// portal follows. Pure, so the wording is pinned by tests.

import {
  PROPERTY_LOOK_SOURCES,
  facetReachesPortal,
  type PortalLookSources,
} from '#/contexts/portal/application/public-api'

/** The three parts of the look a portal follows or has of its own. */
export type LookPart = 'photo' | 'colours' | 'identity'

type Sourced = Readonly<{ lookSources?: PortalLookSources }>

/** Where a portal's look comes from; a row the overview gave no sources for follows the whole look. */
export const sourcesOf = (row: Sourced): PortalLookSources =>
  row.lookSources ?? PROPERTY_LOOK_SOURCES

/** The Property look edit that stands for each part, as the look's own reach rule names it. */
const PART_FACET = { photo: 'photo', colours: 'accent', identity: 'wordmark' } as const

/** Whether an edit of this part of the Property look reaches a portal with these sources. */
export const followsPart = (sources: PortalLookSources, part: LookPart): boolean =>
  facetReachesPortal(PART_FACET[part], sources)

const PARTS: readonly LookPart[] = ['photo', 'colours', 'identity']

/** Whether the Property look still reaches the portal at all: it follows at least one part. */
export const followsAnyPart = (sources: PortalLookSources): boolean =>
  PARTS.some((part) => followsPart(sources, part))

/** The parts the portal does not follow (its own, or no photo at all), in the editor's order. */
export const ownPartsOf = (sources: PortalLookSources): readonly LookPart[] =>
  PARTS.filter((part) => !followsPart(sources, part))

/** The chips of the portal rail: text only, a small copy of a photo in a list would be noise. */
export function ownChipsOf(sources: PortalLookSources): readonly string[] {
  return ownPartsOf(sources).map((part) => {
    if (part === 'photo') return sources.photo === 'none' ? 'No photo' : 'Own photo'
    return part === 'colours' ? 'Own colours' : 'Own name and logo'
  })
}

/** What the preview says in place of its photo switch for a portal whose photo is not the look's; null when it follows. */
export function describeOwnPhoto(
  portal: Readonly<{ name: string; sources?: PortalLookSources }>,
): string | null {
  const sources = sourcesOf({ lookSources: portal.sources })
  if (followsPart(sources, 'photo')) return null
  return `${portal.name} ${sources.photo === 'none' ? 'shows no photo' : 'has its own photo'}`
}

const PART_NOUN: Readonly<Record<LookPart, string>> = {
  photo: 'photo',
  colours: 'colours',
  identity: 'name and logo',
}

type NamedRow = Sourced & Readonly<{ name: string }>

const joinWith = (nouns: readonly string[], last: 'and' | 'or'): string =>
  nouns.length < 3
    ? nouns.join(` ${last} `)
    : `${nouns.slice(0, -1).join(', ')} ${last} ${nouns.at(-1)}`

/**
 * The status line's note on the portals that differ from the look: "Spa has its
 * own photo and colours", or for several portals what kinds of part they have.
 * Null while every portal follows everything.
 */
export function describeOwnLooks(rows: readonly NamedRow[]): string | null {
  const own = rows
    .map((row) => ({ name: row.name, parts: ownPartsOf(sourcesOf(row)) }))
    .filter((entry) => entry.parts.length > 0)
  const [first, ...rest] = own
  if (first === undefined) return null
  if (rest.length === 0) {
    const nouns = first.parts.map((part) => PART_NOUN[part])
    return first.parts.length === PARTS.length
      ? `${first.name} has its own look`
      : `${first.name} has its own ${joinWith(nouns, 'and')}`
  }
  const kinds = PARTS.filter((part) => own.some((entry) => entry.parts.includes(part)))
  return `${own.length} portals have their own ${joinWith(
    kinds.map((part) => PART_NOUN[part]),
    'or',
  )}`
}

type CountedRow = Sourced & Readonly<{ publicationState: string }>

/** The portals a portal can be a sibling of: every one that is not archived. */
export const portalCountOf = (rows: readonly CountedRow[]): number =>
  rows.filter((row) => row.publicationState !== 'archived').length

/**
 * Whether the page tells of portals having their own look: the switch is on and
 * a second portal exists, or a portal already has a part of its own (which stays
 * true to say after the switch is turned off). A property with one portal sees
 * nothing new.
 */
export function offersOwnLook(rows: readonly CountedRow[], enabled: boolean): boolean {
  const hasOwn = rows.some(
    (row) => row.publicationState !== 'archived' && ownPartsOf(sourcesOf(row)).length > 0,
  )
  return hasOwn || (enabled && portalCountOf(rows) >= 2)
}

/**
 * Whether the rail links a portal to its Look section: an Account Admin, the
 * switch on, and a second portal (or the portal already has a part of its own,
 * so it can still be undone after the others are archived).
 */
export function offersLookEdit(
  viewer: Readonly<{ canEdit: boolean; ownLookEnabled: boolean; portalCount: number }>,
  row: Sourced,
): boolean {
  if (!viewer.canEdit || !viewer.ownLookEnabled) return false
  return viewer.portalCount >= 2 || ownPartsOf(sourcesOf(row)).length > 0
}

/** The page's one sentence of purpose: the look every portal starts with once portals can have their own. */
export function describeLookHeader(propertyName: string, ownLook: boolean): string {
  return ownLook
    ? `The look every portal at ${propertyName} starts with. A portal can use its own photo, colours, or name and logo.`
    : `How every portal at ${propertyName} looks. Portal wording and links stay per portal.`
}
