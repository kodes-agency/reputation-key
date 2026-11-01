import { Popover, PopoverContent } from '#/components/ui/popover'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { staffAccessLine } from './staff-account-view'
import { useStaffAccounts } from './staff-accounts-context'
import { StaffRetry } from './staff-member-actions'
export function StaffPortalMeta({
  portalId,
  hint = false,
  skipsRating = false,
}: Readonly<{ portalId: string; hint?: boolean; skipsRating?: boolean }>) {
  const accounts = useStaffAccounts()
  const member = accounts?.members.find(
    (person) => person.portalId === portalId || person.participationId === portalId,
  )
  if (!member) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{staffAccessLine(member.access)}</span>
      <StaffRetry member={member} />
      {skipsRating ? <span>Skips rating</span> : null}
      {hint ? (
        <Popover>
          <ExplainTrigger touch>High rating from few guests</ExplainTrigger>
          <PopoverContent>
            Their average is high, but few guests scanned this code compared with
            colleagues. It may be worth checking the code is offered to everyone.
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
