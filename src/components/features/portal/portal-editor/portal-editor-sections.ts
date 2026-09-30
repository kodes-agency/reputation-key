// The editor's section list — a registry, not a component. The order is the
// order guests meet the page in (Look, Welcome, the rating card, the private
// note, the Linktree, the footer), followed by what only managers see. Both
// the navigation and the panel read it, so a section cannot be in one and not
// the other, and `?section=` can only ever name a section that exists.

export const PORTAL_EDITOR_SECTIONS = [
  'look',
  'welcome',
  'rating',
  'private-note',
  'linktree',
  'footer',
  'languages',
  'group',
  'responsible',
] as const

export type PortalEditorSection = (typeof PORTAL_EDITOR_SECTIONS)[number]

export const PORTAL_EDITOR_SECTION_LABELS: Readonly<Record<PortalEditorSection, string>> =
  {
    look: 'Look',
    welcome: 'Welcome',
    rating: 'Rating & Google',
    'private-note': 'Private note',
    linktree: 'Linktree',
    footer: 'Footer',
    languages: 'Languages',
    group: 'Group',
    responsible: 'Responsible',
  }

export type PortalEditorSectionGroup = Readonly<{
  heading: string
  sections: ReadonlyArray<PortalEditorSection>
}>

export const PORTAL_EDITOR_SECTION_GROUPS: ReadonlyArray<PortalEditorSectionGroup> = [
  {
    heading: 'On the page',
    sections: ['look', 'welcome', 'rating', 'private-note', 'linktree', 'footer'],
  },
  { heading: 'Behind the page', sections: ['languages', 'group', 'responsible'] },
]

/**
 * The section that opens when the URL names none. Welcome, not Look: the
 * portal's name and description are what a manager edits most, and Look is
 * property-wide.
 */
export const DEFAULT_PORTAL_EDITOR_SECTION: PortalEditorSection = 'welcome'

export function isPortalEditorSection(value: unknown): value is PortalEditorSection {
  return (
    typeof value === 'string' &&
    (PORTAL_EDITOR_SECTIONS as readonly string[]).includes(value)
  )
}

/**
 * Which sections have something to show. Group and Responsible read data the
 * route may not have (a viewer without access to it), and an empty panel is a
 * dead end, so they are withheld rather than rendered blank.
 */
export function availablePortalEditorSections(
  has: Readonly<{ group: boolean; responsible: boolean }>,
): ReadonlyArray<PortalEditorSection> {
  return PORTAL_EDITOR_SECTIONS.filter((section) => {
    if (section === 'group') return has.group
    if (section === 'responsible') return has.responsible
    return true
  })
}

/** The section actually shown: the requested one if offered, else the default. */
export function resolvePortalEditorSection(
  requested: PortalEditorSection | undefined,
  available: ReadonlyArray<PortalEditorSection>,
): PortalEditorSection {
  if (requested !== undefined && available.includes(requested)) return requested
  if (available.includes(DEFAULT_PORTAL_EDITOR_SECTION)) {
    return DEFAULT_PORTAL_EDITOR_SECTION
  }
  return available[0] ?? DEFAULT_PORTAL_EDITOR_SECTION
}
