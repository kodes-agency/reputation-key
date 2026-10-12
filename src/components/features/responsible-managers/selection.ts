export const normalizeResponsibleManagerIds = (ids: readonly string[]) =>
  [...new Set(ids)].sort()

const sameResponsibleManagerIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index])

/** The responsible managers as the server holds them, and the revision that names that state. */
export type ResponsibleManagerServerState = Readonly<{
  selection: readonly string[]
  revision: number
}>

/** A selection the person changed, and the server state they changed it from. */
export type ResponsibleManagerEdit = Readonly<{
  selected: readonly string[]
  base: ResponsibleManagerServerState
}>

/**
 * Whether an edit still says something the server does not: it differs from
 * the state it was started from (the person has not undone it) and from the
 * state the server holds now (nobody else, and no save of its own, has made
 * the same change).
 */
export const isLiveResponsibleManagerEdit = (
  edit: ResponsibleManagerEdit,
  server: ResponsibleManagerServerState,
): boolean =>
  !sameResponsibleManagerIds(edit.selected, edit.base.selection) &&
  !sameResponsibleManagerIds(edit.selected, server.selection)

/**
 * What the panel shows, and the revision a save of it names.
 *
 * With no live edit the panel follows the server: a refresh is adopted, with
 * its revision. A live edit is kept across a refresh, and it is saved with the
 * revision of the state it was started from, never the refreshed one. The
 * revision is the server's fence against overwriting a change the person has
 * not seen (`property-responsible-manager.repository.ts` refuses a save whose
 * revision is behind), and a kept selection has not seen the refresh: sent
 * with the newer revision it was accepted, and it ended every manager another
 * admin had added meanwhile.
 */
export const resolveResponsibleManagerSelection = (
  edit: ResponsibleManagerEdit | null,
  server: ResponsibleManagerServerState,
): Readonly<{ selected: readonly string[]; expectedRevision: number; dirty: boolean }> =>
  edit !== null && isLiveResponsibleManagerEdit(edit, server)
    ? { selected: edit.selected, expectedRevision: edit.base.revision, dirty: true }
    : { selected: server.selection, expectedRevision: server.revision, dirty: false }
