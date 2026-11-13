import { StaffAccountRow } from './staff-account-row'
import { StaffColleagueSetting } from './staff-colleague-setting'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { useState, type Dispatch, type SetStateAction } from 'react'
import type { StaffMember } from './staff-account-view'
import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { FormSelectField } from '#/components/forms/form-select-field'
import { AddAction } from '#/components/ui/add-action'
import {
  DataTable,
  DataTableBody,
  DataTableHeader,
  DataTableHead,
} from '#/components/ui/data-table'
import { portalKeys } from '#/shared/queries/query-keys'
import { useStaffFunctions } from './staff-account-functions'
import { useStaffAccounts } from './staff-accounts-context'
import { filterStaff, notJoined } from './staff-list-view'
import { useStaffResults } from './use-staff-results'
import { StaffBulkActions } from './staff-bulk-actions'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

export function StaffAddAction({
  variant = 'default',
}: Readonly<{ variant?: 'default' | 'outline' }> = {}) {
  const accounts = useStaffAccounts()
  return accounts?.canInvite ? (
    <AddAction variant={variant} onClick={() => accounts.openAdd()}>
      Add staff
    </AddAction>
  ) : null
}
export function StaffAccountsList() {
  const accounts = useStaffAccounts()
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [joined, setJoined] = useState('all')
  const [group, setGroup] = useState('all')
  const [selected, setSelected] = useState<readonly string[]>([])
  const groups = useStaffGroups()
  const results = useStaffResults(accounts?.propertyId ?? '')
  if (!accounts) return null
  const shown = filterStaff(accounts.members, joined, group)
  const groupOptions = groups.data?.groups ?? []
  const selectable =
    accounts.members.length > 1 &&
    (accounts.canInvite || (can('portal.update') && has('portal.write')))
  const selectedMembers = accounts.members.filter((member) =>
    selected.includes(member.participationId),
  )
  const now = results.data?.total.kpis.scans.evidence.computedAt ?? new Date()
  const zone = results.data?.properties.find(
    (property) => property.propertyId === accounts.propertyId,
  )?.timezone
  return (
    <section aria-label="Staff" className="space-y-4">
      <StaffListToolbar
        members={accounts.members}
        joined={joined}
        group={group}
        onJoined={setJoined}
        onGroup={setGroup}
        groups={groupOptions}
      />
      <FormErrorBanner error={groups.error ?? results.error} />
      <StaffRosterRows
        selectable={selectable}
        shown={shown}
        selected={selected}
        setSelected={setSelected}
        results={results.data}
        zone={zone}
        now={now}
      />
      {selectable && selectedMembers.length > 0 ? (
        <StaffBulkActions
          selected={selectedMembers}
          groups={groupOptions}
          onClear={() => setSelected([])}
        />
      ) : null}
      <StaffFilterEmpty
        total={accounts.members.length}
        shown={shown.length}
        onClear={() => {
          setGroup('all')
          setJoined('all')
        }}
      />
      <StaffColleagueSetting />
    </section>
  )
}

function useStaffGroups() {
  const accounts = useStaffAccounts()
  const functions = useStaffFunctions()
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return useQuery({
    queryKey: portalKeys.groups(accounts?.propertyId ?? ''),
    queryFn: () =>
      functions.listPortalGroups({ data: { propertyId: accounts!.propertyId } }),
    enabled: Boolean(accounts) && can('portal.read') && has('portal.read'),
  })
}

function StaffFilterEmpty({
  total,
  shown,
  onClear,
}: Readonly<{ total: number; shown: number; onClear: () => void }>) {
  if (!total || shown) return null
  return (
    <EmptyState
      icon={Users}
      title="No staff match these filters"
      action={
        <Button variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  )
}

function StaffListToolbar({
  members,
  joined,
  group,
  onJoined,
  onGroup,
  groups,
}: Readonly<{
  members: import('./staff-account-view').StaffMember[] | readonly StaffMember[]
  joined: string
  group: string
  onJoined: (value: string) => void
  onGroup: (value: string) => void
  groups: readonly Readonly<{ id: string; name: string }>[]
}>) {
  const pending = members.filter(notJoined).length
  return (
    <div className="flex flex-wrap items-end gap-3">
      {pending > 0 && pending < members.length ? (
        <SegmentedControl
          aria-label="Show staff"
          value={joined}
          onValueChange={onJoined}
          options={[
            { value: 'all', label: `Everyone (${members.length})` },
            { value: 'pending', label: `Not joined (${pending})` },
          ]}
        />
      ) : null}
      {new Set(members.map((member) => member.group?.id ?? 'none')).size > 1 ? (
        <FormSelectField
          id="staff-group-filter"
          label="Group"
          value={group}
          onValueChange={onGroup}
          options={[
            { value: 'all', label: 'All groups' },
            { value: 'none', label: 'No group' },
            ...groups.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      ) : null}
    </div>
  )
}

function StaffRosterRows({
  selectable,
  shown,
  selected,
  setSelected,
  results,
  zone,
  now,
}: Readonly<{
  selectable: boolean
  shown: readonly StaffMember[]
  selected: readonly string[]
  setSelected: Dispatch<SetStateAction<readonly string[]>>
  results: ReturnType<typeof useStaffResults>['data']
  zone?: string
  now: Date
}>) {
  const accounts = useStaffAccounts()!
  return (
    <>
      {accounts.members.length ? (
        <DataTable label="Staff" layout="cards" from="4xl">
          <DataTableHeader>
            {selectable ? (
              <DataTableHead className="w-10">
                <span className="sr-only">Select</span>
              </DataTableHead>
            ) : null}
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Group</DataTableHead>
            <DataTableHead>Access</DataTableHead>
            <DataTableHead>Scans this month</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {shown.map((member) => (
              <StaffAccountRow
                key={member.participationId}
                member={member}
                figures={results?.portals.find(
                  (portal) => portal.portalId === member.portalId,
                )}
                zone={zone}
                now={now}
                selectable={selectable}
                selected={selected.includes(member.participationId)}
                onSelect={() =>
                  setSelected((current) =>
                    current.includes(member.participationId)
                      ? current.filter((id) => id !== member.participationId)
                      : [...current, member.participationId],
                  )
                }
                onOpen={() => accounts.openPerson?.(member.participationId)}
              />
            ))}
          </DataTableBody>
        </DataTable>
      ) : accounts.ready ? (
        <EmptyState icon={Users} title="No staff yet" action={<StaffAddAction />} />
      ) : null}
    </>
  )
}
