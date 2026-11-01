import { useRef, useState } from 'react'
import { useDialogBusy } from '#/components/ui/dialog-dismissal'
import { useStaffFunctions } from './staff-account-functions'
import type { StaffAddFormProps } from './staff-add-form'
import {
  checkedStaffRows,
  newStaffRow,
  pasteStaffRows,
  sendStaffRows,
  staffBatchProblem,
  type StaffDraftRow,
} from './staff-batch'
export function useStaffBatch({
  propertyId,
  initialGroupId,
  portals,
  check,
  add,
  initialRows,
}: StaffAddFormProps) {
  const functions = useStaffFunctions()
  const checkBatch = check ?? functions.checkStaffBatch
  const addMember = add ?? functions.addStaffMember
  const [rows, setRows] = useState<readonly StaffDraftRow[]>(
    () => initialRows ?? [newStaffRow(crypto.randomUUID())],
  )
  const [source, setSource] = useState(portals[0]?.id ?? 'property')
  const [group, setGroup] = useState(initialGroupId ?? 'none')
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [omitted, setOmitted] = useState(0)
  const [links, setLinks] = useState<readonly string[]>([])
  const running = useRef(false)
  useDialogBusy(busy)
  const plan = {
    propertyId,
    ...(source === 'property' ? {} : { sourcePortalId: source }),
    ...(group === 'none' ? {} : { portalGroupId: group }),
  }
  const replace = (next: StaffDraftRow) =>
    setRows((current) =>
      current.map((row) => (row.operationId === next.operationId ? next : row)),
    )
  const send = (row: StaffDraftRow) =>
    addMember({
      data: {
        ...plan,
        operationId: row.operationId,
        email: row.email,
        displayName: row.displayName,
      },
    })
  const retry = async (row: StaffDraftRow) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await sendStaffRows([row], send, replace)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const submit = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await checkBatch({
        data: {
          ...plan,
          rows: rows.map(({ email, displayName }) => ({ email, displayName })),
        },
      })
      const checked = checkedStaffRows(rows, result)
      setRows(checked)
      setLinks(result.omittedLinks.map((link) => link.label))
      const problem = staffBatchProblem(
        result,
        portals.find((p) => p.id === source)?.name,
      )
      if (problem) {
        setError(problem)
        return
      }
      if (checked.some((row) => row.problem)) return
      setStarted(true)
      await sendStaffRows(rows, send, replace)
    } catch (failure) {
      setError(failure)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const paste = (index: number, text: string) => {
    const pasted = pasteStaffRows(rows, index, text, () => crypto.randomUUID())
    setRows(pasted.rows)
    setOmitted(pasted.omitted)
  }
  return {
    rows,
    source,
    setSource,
    group,
    setGroup,
    busy,
    started,
    error,
    omitted,
    links,
    replace,
    retry,
    submit,
    paste,
    setRows,
  }
}
