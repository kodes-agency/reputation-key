import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { OwnerDisc } from '#/components/ui/owner-disc'
import { personInitials } from '#/components/inbox/person-initials'
import { DataTableRow, DataTableCell } from '#/components/ui/data-table'
import type { PortalResultsPortalRow } from '#/contexts/reporting/application/public-api'
import { staffAccessLine, type StaffMember } from './staff-account-view'
import { staffProblem } from './staff-batch'
import { staffNoScansLately } from './staff-no-scans-lately'
import { StaffInvitationRepair } from './staff-member-actions'

export function StaffAccountRow({
  member,
  figures,
  zone,
  now,
  selectable,
  selected,
  onSelect,
  onOpen,
}: Readonly<{
  member: StaffMember
  figures?: PortalResultsPortalRow
  zone?: string
  now: Date
  selectable: boolean
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}>) {
  const quiet =
    zone &&
    figures?.kpis.scans.evidence.state === 'ready' &&
    staffNoScansLately({ ...member, lastScanAt: figures.lastScanAt, now, timeZone: zone })
  return (
    <DataTableRow key={member.participationId} tracks={2}>
      {selectable ? (
        <DataTableCell className="col-start-2 row-start-1 self-center @4xl:table-cell @4xl:p-3">
          <Checkbox
            aria-label={`Select ${member.displayName}`}
            checked={selected}
            onCheckedChange={onSelect}
          />
        </DataTableCell>
      ) : null}
      <DataTableCell className="col-start-1 row-start-1 @4xl:table-cell @4xl:p-3">
        <div className="flex min-w-0 items-center gap-2">
          <OwnerDisc
            size="person"
            initials={personInitials(member.displayName)}
            isAssigned
            tone="neutral"
          />
          <div className="min-w-0">
            <Button variant="row-name" size="inline" touch onClick={onOpen}>
              {member.displayName}
            </Button>
            {member.email ? (
              <p className="break-all text-sm text-muted-foreground">{member.email}</p>
            ) : null}
          </div>
        </div>
      </DataTableCell>
      <DataTableCell className="col-span-2 text-sm text-muted-foreground @4xl:table-cell @4xl:p-3">
        {member.group?.name ?? 'No group'}
      </DataTableCell>
      <DataTableCell className="col-span-2 text-sm @4xl:table-cell @4xl:p-3">
        <p>{staffAccessLine(member.access)}</p>
        <StaffInvitationRepair member={member} />
        {member.code ? <p className="text-sm">{staffProblem(member.code)}</p> : null}
      </DataTableCell>
      <DataTableCell className="col-span-2 text-sm @4xl:table-cell @4xl:p-3">
        <span className="font-mono">{figures?.kpis.scans.value ?? '—'}</span>
        <span className="@4xl:hidden"> scans this month</span>
        {quiet ? <p className="text-sm text-muted-foreground">No scans lately</p> : null}
      </DataTableCell>
    </DataTableRow>
  )
}
