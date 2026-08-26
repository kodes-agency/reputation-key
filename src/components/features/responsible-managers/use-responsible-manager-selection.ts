import { useEffect, useMemo, useRef, useState } from 'react'
import {
  normalizeResponsibleManagerIds,
  reconcileResponsibleManagerSelection,
} from './selection'

export function useResponsibleManagerSelection(
  assignments: readonly Readonly<{ userId: string }>[],
) {
  const serverSelection = useMemo(
    () => normalizeResponsibleManagerIds(assignments.map((row) => row.userId)),
    [assignments],
  )
  const priorServerSelection = useRef(serverSelection)
  const [selected, setSelected] = useState(serverSelection)

  useEffect(() => {
    const prior = priorServerSelection.current
    setSelected((current) =>
      reconcileResponsibleManagerSelection(current, prior, serverSelection),
    )
    priorServerSelection.current = serverSelection
  }, [serverSelection])

  return { selected, setSelected, serverSelection } as const
}
