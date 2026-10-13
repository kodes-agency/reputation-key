// The portals a group dialog offers, as the checklist prints them: grouped by
// where each portal is now ("Not in a group" first, then "In <group>"), because
// choosing a portal that is already in another group moves it, and the dialog
// says so under the portal. Pure, so the sections and the wording are tested
// without a dialog.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'

export type ChecklistPortal = Readonly<{
  id: string
  name: string
  /** A small fact beside the name: only a draft or an archived portal has one. */
  fact: 'Draft' | 'Archived' | null
  /** The group the portal is in today; choosing it moves it out of there. */
  movesFrom: string | null
}>

export type ChecklistSection = Readonly<{
  key: string
  label: string
  portals: readonly ChecklistPortal[]
}>

export type ChecklistOptions = Readonly<{
  /** Adding to this group: its own portals are not offered again. */
  addingToGroupId?: string
}>

const NOT_IN_A_GROUP = 'Not in a group'

const byName = (left: { name: string }, right: { name: string }): number =>
  left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })

function factOf(state: PortalOverviewRow['publicationState']): ChecklistPortal['fact'] {
  if (state === 'draft') return 'Draft'
  return state === 'archived' ? 'Archived' : null
}

function toChecklistPortal(row: PortalOverviewRow): ChecklistPortal {
  return {
    id: row.portalId,
    name: row.name,
    fact: factOf(row.publicationState),
    movesFrom: row.group?.name ?? null,
  }
}

export function buildPortalChecklist(
  rows: readonly PortalOverviewRow[],
  options: ChecklistOptions = {},
): readonly ChecklistSection[] {
  const { addingToGroupId } = options
  const offered = rows.filter(
    (row) => addingToGroupId === undefined || row.group?.id !== addingToGroupId,
  )
  const ungrouped = offered.filter((row) => !row.group)
  const groups = new Map<string, { name: string; rows: PortalOverviewRow[] }>()
  for (const row of offered) {
    if (!row.group) continue
    const entry = groups.get(row.group.id) ?? { name: row.group.name, rows: [] }
    groups.set(row.group.id, { ...entry, rows: [...entry.rows, row] })
  }
  const sections: ChecklistSection[] = [
    {
      key: 'ungrouped',
      label: NOT_IN_A_GROUP,
      portals: ungrouped.map(toChecklistPortal).sort(byName),
    },
    ...[...groups.entries()]
      .map(([key, entry]) => ({
        key,
        label: `In ${entry.name}`,
        name: entry.name,
        portals: entry.rows.map(toChecklistPortal).sort(byName),
      }))
      .sort(byName)
      .map(({ key, label, portals }) => ({ key, label, portals })),
  ]
  return sections.filter((section) => section.portals.length > 0)
}

/** A new list: the portal is in it once when `selected`, and not at all otherwise. */
export function toggleSelection(
  current: readonly string[],
  portalId: string,
  selected: boolean,
): readonly string[] {
  const without = current.filter((id) => id !== portalId)
  return selected ? [...without, portalId] : without
}

export function describeSelection(count: number): string {
  if (count === 0) return 'No portals selected'
  return `${count} ${count === 1 ? 'portal' : 'portals'} selected`
}

/** The note beside "Create group": a group needs only a name, so none ticked says portals are optional. */
export function describeNewGroupSelection(count: number): string {
  return count === 0
    ? 'Portals are optional. You can add them later.'
    : describeSelection(count)
}
