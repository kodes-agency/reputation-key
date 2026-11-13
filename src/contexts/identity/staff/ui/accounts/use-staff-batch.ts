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
  wording,
  saveWording,
}: StaffAddFormProps) {
  const functions = useStaffFunctions()
  const checkBatch = check ?? functions.checkStaffBatch
  const addMember = add ?? functions.addStaffMember
  const [rows, setRows] = useState<readonly StaffDraftRow[]>(
    () => initialRows ?? [newStaffRow(crypto.randomUUID())],
  )
  const [source, setSource] = useState(initialStaffSource(portals, initialGroupId))
  const [group, setGroup] = useState(initialGroupId ?? 'none')
  const [title, setTitle] = useState(wording?.title ?? '')
  const [shortDescription, setShortDescription] = useState(
    wording?.shortDescription ?? '',
  )
  const needsWording = source === 'property' && wording?.required
  const canSubmit = staffCanSubmit(source, wording, title, shortDescription)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [omitted, setOmitted] = useState(0)
  const [links, setLinks] = useState<readonly string[]>([])
  const running = useRef(false)
  useDialogBusy(busy)
  const plan = staffBatchPlan(propertyId, source, group)
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
    if (running.current || !canSubmit) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await saveGuestWording(
        { propertyId, wording, saveWording },
        needsWording === true,
        title,
        shortDescription,
      )
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
    title,
    setTitle,
    shortDescription,
    setShortDescription,
    canSubmit,
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

export function initialStaffSource(
  portals: StaffAddFormProps['portals'],
  groupId?: string,
): string {
  if (!portals.length) return 'property'
  const inGroup = groupId ? portals.filter((portal) => portal.groupId === groupId) : []
  if (inGroup.length === 1) return inGroup[0]!.id
  return portals.length === 1 ? portals[0]!.id : ''
}

function staffCanSubmit(
  source: string,
  wording: StaffAddFormProps['wording'],
  title: string,
  description: string,
): boolean {
  if (!source) return false
  if (source !== 'property' || !wording?.required) return true
  return Boolean(wording.canWrite && title.trim() && description.trim())
}
async function saveGuestWording(
  props: Pick<StaffAddFormProps, 'propertyId' | 'wording' | 'saveWording'>,
  needed: boolean,
  title: string,
  shortDescription: string,
) {
  if (!needed || !props.wording) return
  if (!props.saveWording) throw new Error('Guest wording could not be saved.')
  await props.saveWording({
    data: {
      propertyId: props.propertyId,
      locale: props.wording.locale,
      title: title.trim(),
      shortDescription: shortDescription.trim(),
    },
  })
}

function staffBatchPlan(propertyId: string, source: string, group: string) {
  return {
    propertyId,
    ...(source === 'property' ? {} : { sourcePortalId: source }),
    ...(group === 'none' ? {} : { portalGroupId: group }),
  }
}
