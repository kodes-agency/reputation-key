import { useStaffBatch } from './use-staff-batch'
import type {
  checkStaffBatch,
  addStaffMember,
} from '#/contexts/identity/server/staff-accounts'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormSelectField } from '#/components/forms/form-select-field'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { StaffAddRow } from './staff-add-row'
import { newStaffRow, STAFF_BATCH_LIMIT, type StaffDraftRow } from './staff-batch'

type Option = Readonly<{ id: string; name: string }>
export type StaffAddFormProps = Readonly<{
  propertyId: string
  initialGroupId?: string
  portals: readonly Option[]
  groups: readonly Option[]
  check?: (
    input: Parameters<typeof checkStaffBatch>[0],
  ) => ReturnType<typeof checkStaffBatch>
  add?: (input: Parameters<typeof addStaffMember>[0]) => ReturnType<typeof addStaffMember>
  initialRows?: readonly StaffDraftRow[]
}>

export function StaffAddForm(props: StaffAddFormProps) {
  const { portals, groups } = props
  const {
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
  } = useStaffBatch(props)
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!started) void submit()
      }}
    >
      <FormSelectField
        id="staff-source"
        label="Portal to copy"
        value={source}
        onValueChange={setSource}
        disabled={busy || started}
        options={[
          { value: 'property', label: "Start from the property's wording" },
          ...portals.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      <FormSelectField
        id="staff-group"
        label="Group"
        optional
        value={group}
        onValueChange={setGroup}
        disabled={busy || started}
        options={[
          { value: 'none', label: 'No group' },
          ...groups.map((g) => ({ value: g.id, label: g.name })),
        ]}
      />
      {rows.map((row, index) => (
        <StaffAddRow
          key={row.operationId}
          row={row}
          index={index}
          removable={rows.length > 1}
          busy={busy}
          onChange={(field, text) => replace({ ...row, [field]: text, problem: null })}
          onPaste={(text) => paste(index, text)}
          onRemove={() =>
            setRows((current) =>
              current.filter((person) => person.operationId !== row.operationId),
            )
          }
          onRetry={() => void retry(row)}
        />
      ))}
      {omitted > 0 ? (
        <p role="status" className="text-sm">
          {omitted} people were left out. You can add up to 20 at a time.
        </p>
      ) : null}
      <StaffAddMore
        started={started}
        count={rows.length}
        busy={busy}
        onAdd={() => setRows((current) => [...current, newStaffRow(crypto.randomUUID())])}
      />
      {links.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          The copy leaves out: {links.join(', ')}.
        </p>
      ) : null}
      <FormErrorBanner error={error} />
      <StaffAddFooter started={started} busy={busy} />
    </form>
  )
}

function StaffAddMore({
  started,
  count,
  busy,
  onAdd,
}: Readonly<{ started: boolean; count: number; busy: boolean; onAdd: () => void }>) {
  if (started) return null
  if (count >= STAFF_BATCH_LIMIT)
    return <p className="text-sm">You can add up to 20 people at a time.</p>
  return (
    <Button type="button" variant="outline" disabled={busy} onClick={onAdd}>
      Add another
    </Button>
  )
}

function StaffAddFooter({
  started,
  busy,
}: Readonly<{ started: boolean; busy: boolean }>) {
  return (
    <DialogFooter>
      <DialogCancel>{started ? 'Close' : 'Cancel'}</DialogCancel>
      {started ? null : (
        <Button type="submit" pending={busy} pendingLabel="Adding…">
          Add
        </Button>
      )}
    </DialogFooter>
  )
}
