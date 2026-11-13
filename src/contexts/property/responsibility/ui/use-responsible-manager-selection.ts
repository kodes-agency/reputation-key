import { useMemo, useState } from 'react'
import {
  isLiveResponsibleManagerEdit,
  normalizeResponsibleManagerIds,
  resolveResponsibleManagerSelection,
  toggleResponsibleManager,
  type ResponsibleManagerEdit,
  type ResponsibleManagerServerState,
} from './selection'

/**
 * The panel's selection: the server's, until the person changes it.
 *
 * Only an edit is held in state, with the server state it was started from;
 * everything shown is derived from it and the latest read
 * (`resolveResponsibleManagerSelection`). An edit that is no longer one (undone,
 * saved, or made by someone else too) is dropped during render rather than in
 * an effect, so it cannot come back as an unsaved change when the server moves
 * again later.
 */
export function useResponsibleManagerSelection(
  assignments: readonly Readonly<{ userId: string }>[],
  revision: number,
) {
  const server: ResponsibleManagerServerState = useMemo(
    () => ({
      selection: normalizeResponsibleManagerIds(assignments.map((row) => row.userId)),
      revision,
    }),
    [assignments, revision],
  )
  const [held, setHeld] = useState<ResponsibleManagerEdit | null>(null)
  const edit = held !== null && isLiveResponsibleManagerEdit(held, server) ? held : null
  if (edit !== held) setHeld(edit)

  const { selected, expectedRevision, dirty } = resolveResponsibleManagerSelection(
    edit,
    server,
  )

  const toggle = (userId: string, checked: boolean) =>
    setHeld((current) => toggleResponsibleManager(current, server, userId, checked))

  return {
    selected,
    /** The revision a save of `selected` names. */
    expectedRevision,
    dirty,
    toggle,
    /** Back to what the server holds now. */
    reset: () => setHeld(null),
  } as const
}
