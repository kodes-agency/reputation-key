import { staffProblem } from './staff-batch'
import { staffNoScansLately } from './staff-no-scans-lately'
import { useStaffResults } from './use-staff-results'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { staffAccessLine } from './staff-account-view'
import { useStaffAccounts } from './staff-accounts-context'
import { StaffRetry, StaffInvitationRepair } from './staff-member-actions'
export function StaffPortalMeta({
  portalId,
  hint = false,
  skipsRating = false,
}: Readonly<{ portalId: string; hint?: boolean; skipsRating?: boolean }>) {
  const accounts = useStaffAccounts()
  const results = useStaffResults(accounts?.propertyId ?? '')
  const figure = results.data?.portals.find((row) => row.portalId === portalId)
  const zone = results.data?.properties.find(
    (row) => row.propertyId === accounts?.propertyId,
  )?.timezone
  const member = accounts?.members.find(
    (person) => person.portalId === portalId || person.participationId === portalId,
  )
  if (!member) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{staffAccessLine(member.access)}</span>
      <StaffRetry member={member} />
      <StaffInvitationRepair member={member} />
      {member.code ? <span>{staffProblem(member.code)}</span> : null}
      {figure &&
      figure.kpis.scans.evidence.state === 'ready' &&
      zone &&
      staffNoScansLately({
        ...member,
        lastScanAt: figure.lastScanAt,
        now: figure.kpis.scans.evidence.computedAt,
        timeZone: zone,
      }) ? (
        <span>No scans lately</span>
      ) : null}
      {skipsRating ? <span>Skips rating</span> : null}
      {hint ? <StaffRatingHint /> : null}
    </div>
  )
}

export function StaffRatingHint() {
  return (
    <Popover>
      <ExplainTrigger touch>High rating from few guests</ExplainTrigger>
      <PopoverContent>
        Their average is high, but few guests scanned this code compared with colleagues.
        It may be worth checking the code is offered to everyone.
      </PopoverContent>
    </Popover>
  )
}
