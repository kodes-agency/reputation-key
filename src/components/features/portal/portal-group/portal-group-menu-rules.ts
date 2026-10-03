// What a group's "Actions" menu offers, and to whom. The group's page is one
// destination of the menu in the overview, so its own menu leaves "Open group"
// out, and also "Rename", which the page offers as a button of its own. Pure, so
// each rule that keeps an action off a role or a switched-off capability is
// tested apart from the menu.

export type GroupMenuAccess = Readonly<{
  /** `portal.update` */
  canRename: boolean
  /** `portal.delete` */
  canArchive: boolean
  /** The organisation's `portal.write` capability: the server refuses writes without it. */
  portalWriteEnabled: boolean
  /** `goal.create`, and the organisation's `goal.use` capability. */
  canSetGoal: boolean
}>

export type GroupMenuItemId = 'open' | 'rename' | 'goal' | 'archive'

// Archiving a group keeps its history and its portals, so its entry is neutral
// like its confirmation; red is for an action that cannot be taken back.
export type GroupMenuItem = Readonly<{
  id: GroupMenuItemId
  label: string
}>

const item = (id: GroupMenuItemId, label: string): GroupMenuItem => ({ id, label })

export function groupMenu(
  access: GroupMenuAccess,
  where: 'overview' | 'page',
): readonly GroupMenuItem[] {
  return [
    ...(where === 'overview' ? [item('open', 'Open group')] : []),
    ...(where === 'overview' && access.canRename && access.portalWriteEnabled
      ? [item('rename', 'Rename…')]
      : []),
    ...(access.canSetGoal ? [item('goal', 'Set a goal')] : []),
    ...(access.canArchive && access.portalWriteEnabled
      ? [item('archive', 'Archive group…')]
      : []),
  ]
}

/**
 * What the group's page lets this reader change in place. Renaming, adding a
 * portal and taking one out are all Portal updates, which the server also
 * refuses while the organisation's `portal.write` capability is off.
 */
export function groupPageControls(access: GroupMenuAccess): Readonly<{
  canEdit: boolean
}> {
  return { canEdit: access.canRename && access.portalWriteEnabled }
}
