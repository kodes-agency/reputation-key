// The one quiet line under each section name in the editor's list — what a
// manager needs to know about a section without opening it. Pure and separate
// from the navigation so the words are pinned by a test, not by JSX.

import type { PortalGroupView } from '../portal-group-types'
import type { PortalEditorSection } from './portal-editor-sections'

export type PortalEditorSummaryInput = Readonly<{
  portalName: string
  privateFeedbackThreshold: number
  linkCount: number
  languageCount: number
  /** Texts missing across every language; absent while the coverage read is not known. */
  missingTextCount?: number
  /** The group's name, or null for a portal outside any group. */
  groupName: string | null
  /** Full names of the responsible managers. */
  responsibleNames: ReadonlyArray<string>
}>

export type PortalEditorSectionSummary = Readonly<{
  text: string
  /** Fixed by the product: shown with a lock, not something to edit. */
  locked: boolean
  /** Something the section needs, shown beside the line in the warning colour. */
  attention?: string
}>

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

function firstNames(names: ReadonlyArray<string>): string {
  const firsts = names
    .map((name) => name.trim().split(/\s+/u)[0] ?? '')
    .filter((first) => first !== '')
  return firsts.length === 0 ? 'No one assigned' : firsts.join(', ')
}

export function summarizePortalEditorSections(
  input: PortalEditorSummaryInput,
): Record<PortalEditorSection, PortalEditorSectionSummary> {
  const open = (text: string): PortalEditorSectionSummary => ({ text, locked: false })
  const fixed = (text: string): PortalEditorSectionSummary => ({ text, locked: true })
  return {
    look: open('Colours · property-wide'),
    welcome: open(input.portalName.trim() === '' ? 'Untitled portal' : input.portalName),
    rating: fixed('Always included'),
    'private-note': open(`${input.privateFeedbackThreshold}★ or below`),
    linktree: open(
      input.linkCount === 0 ? 'No links yet' : plural(input.linkCount, 'link', 'links'),
    ),
    footer: fixed('Privacy notice'),
    languages: {
      ...open(plural(input.languageCount, 'language', 'languages')),
      ...((input.missingTextCount ?? 0) > 0
        ? { attention: `${input.missingTextCount} missing` }
        : {}),
    },
    group: open(input.groupName ?? 'Not in a group'),
    responsible: open(firstNames(input.responsibleNames)),
  }
}

/** The group a portal is in, if any. A portal is in at most one group. */
export function findPortalGroup(
  groups: ReadonlyArray<PortalGroupView>,
  portalId: string,
): PortalGroupView | null {
  return groups.find((group) => group.portalIds.includes(portalId)) ?? null
}

/**
 * The responsible managers' names, in assignment order. An assignment whose
 * member is not in the list (removed from the organisation) is left out rather
 * than shown as an id.
 */
export function responsibleManagerNames(
  assignments: ReadonlyArray<Readonly<{ userId: string }>>,
  members: ReadonlyArray<Readonly<{ userId: string; name: string }>>,
): string[] {
  const nameById = new Map(members.map((member) => [member.userId, member.name]))
  return assignments.flatMap(({ userId }) => {
    const name = nameById.get(userId)
    return name === undefined ? [] : [name]
  })
}
