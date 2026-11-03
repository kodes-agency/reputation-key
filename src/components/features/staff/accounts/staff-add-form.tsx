import { CircleAlert, CircleCheck } from 'lucide-react'
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

import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { StaffAccountFunctions } from './staff-account-functions'
import { StaffGuestWording } from './staff-guest-wording'
import { StaffSourcePreview } from './staff-source-preview'
import { DialogHeader, DialogTitle } from '#/components/ui/dialog'
type Option = Readonly<{ id: string; name: string; groupId?: string | null }>
export type StaffAddFormProps = Readonly<{
  wording?: Readonly<{
    required: boolean
    canWrite: boolean
    locale: OfferedGuestLocale
    title: string
    shortDescription: string
  }>
  saveWording?: StaffAccountFunctions['savePropertyPortalBrandContent']
  checkSource?: StaffAccountFunctions['checkStaffSource']
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
    title,
    setTitle,
    shortDescription,
    setShortDescription,
    canSubmit,
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
      <DialogHeader>
        <DialogTitle>
          {started
            ? `${rows.filter((row) => row.state === 'added' || row.state === 'invited').length} of ${rows.length} added`
            : 'Add staff'}
        </DialogTitle>
      </DialogHeader>
      {!started && source === 'property' && props.wording?.required ? (
        <StaffGuestWording
          wording={props.wording}
          title={title}
          shortDescription={shortDescription}
          setTitle={setTitle}
          setShortDescription={setShortDescription}
          busy={busy}
        />
      ) : null}
      {rows.map((row, index) =>
        started ? (
          <StaffAddedRow
            key={row.operationId}
            row={row}
            busy={busy}
            onRetry={() => void retry(row)}
          />
        ) : (
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
        ),
      )}
      {omitted > 0 ? (
        <p role="status" className="text-sm">
          {omitted} {omitted === 1 ? 'person was' : 'people were'} left out. You can add
          up to 20 at a time.
        </p>
      ) : null}
      <StaffAddMore
        started={started}
        count={rows.length}
        busy={busy}
        onAdd={() => setRows((current) => [...current, newStaffRow(crypto.randomUUID())])}
      />
      {!started ? (
        <>
          <FormSelectField
            id="staff-source"
            label="Guests see the same page as"
            description="Its wording, look and links. Its managers hear from guests."
            placeholder="Choose a portal…"
            value={source}
            onValueChange={setSource}
            disabled={busy || started}
            options={[
              ...(portals.length
                ? []
                : [{ value: 'property', label: "This property's wording" }]),
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
          {props.checkSource &&
          source &&
          (source !== 'property' || !props.wording?.required) ? (
            <StaffSourcePreview
              propertyId={props.propertyId}
              source={source}
              group={group}
              checkSource={props.checkSource}
            />
          ) : null}
        </>
      ) : null}
      {links.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          The copy leaves out: {links.join(', ')}.
        </p>
      ) : null}
      <FormErrorBanner error={error} />
      <StaffAddFooter
        started={started}
        busy={busy}
        disabled={!canSubmit}
        count={rows.length}
      />
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" variant="outline" disabled={busy} onClick={onAdd}>
        + Add another
      </Button>
      <p className="text-sm text-muted-foreground">or paste a list from a spreadsheet</p>
    </div>
  )
}

function StaffAddFooter({
  started,
  busy,
  disabled,
  count,
}: Readonly<{ started: boolean; busy: boolean; disabled: boolean; count: number }>) {
  return (
    <DialogFooter>
      <DialogCancel>{started ? 'Done' : 'Cancel'}</DialogCancel>
      {started ? null : (
        <Button type="submit" disabled={disabled} pending={busy} pendingLabel="Adding…">
          {count === 1 ? 'Add 1 person' : `Add ${count} people`}
        </Button>
      )}
    </DialogFooter>
  )
}

function StaffAddedRow({
  row,
  busy,
  onRetry,
}: Readonly<{ row: StaffDraftRow; busy: boolean; onRetry: () => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b py-3">
      {row.state === 'failed' ? (
        <CircleAlert aria-hidden className="size-5 shrink-0 text-negative" />
      ) : (
        <CircleCheck aria-hidden className="size-5 shrink-0 text-positive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{row.displayName}</p>
        <p className="break-all text-sm text-muted-foreground">{row.email}</p>
        <p role="status" className="text-sm">
          {row.problem ??
            {
              sending: 'Adding…',
              added: 'Added',
              invited: 'Invited',
              failed: 'Setup did not finish',
              editing: '',
            }[row.state]}
        </p>
      </div>
      {row.state === 'failed' ? (
        <Button variant="outline" disabled={busy} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
