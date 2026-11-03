import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { DescriptionItem } from '#/components/ui/description-list'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { goalKeys, portalKeys } from '#/shared/queries/query-keys'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { useStaffAccounts } from './staff-accounts-context'
import { useStaffFunctions } from './staff-account-functions'
import type { StaffMember } from './staff-account-view'
import type { Action } from '#/components/hooks/use-action'

export function StaffPersonGroup({
  member,
  move,
}: Readonly<{ member: StaffMember; move: Action<string> }>) {
  const accounts = useStaffAccounts()!
  const functions = useStaffFunctions()
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const groups = useQuery({
    queryKey: portalKeys.groups(accounts.propertyId),
    queryFn: () =>
      functions.listPortalGroups({ data: { propertyId: accounts.propertyId } }),
  })
  return (
    <DescriptionItem term="Group">
      {can('portal.update') && has('portal.write') ? (
        <Select
          value={member.group?.id ?? 'none'}
          disabled={move.isPending || groups.isPending}
          onValueChange={(group) => void move(group).catch(() => undefined)}
        >
          <SelectTrigger aria-label="Group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No group</SelectItem>
            {(groups.data?.groups ?? []).map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        (member.group?.name ?? 'No group')
      )}
      <FormErrorBanner error={move.error ?? groups.error} />
    </DescriptionItem>
  )
}

/** A value with its one link at the row's end, so the two never run together. */
export function StaffPersonValue({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="flex items-center justify-between gap-3">{children}</span>
}

export function StaffPersonTarget({ member }: Readonly<{ member: StaffMember }>) {
  const accounts = useStaffAccounts()!
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const functions = useStaffFunctions()
  const enabled =
    accounts.staffScanTargetsEnabled === true && can('goal.create') && has('goal.use')
  const goal = useQuery({
    queryKey: goalKeys.portalGoalLine(accounts.propertyId, member.portalId!),
    queryFn: () =>
      functions.getMonthlyPortalGoalLine({
        data: { propertyId: accounts.propertyId, portalId: member.portalId! },
      }),
    enabled,
  })
  if (!enabled) return null
  const target = goal.data?.ownGoal
  let text = 'Loading…'
  if (goal.isError) text = 'Target unavailable'
  if (goal.isSuccess)
    text = target ? `${target.value} of ${target.target} this month` : 'No target'
  return (
    <DescriptionItem term="Scan target">
      <StaffPersonValue>
        <span>{text}</span>
        {goal.isSuccess ? (
          target ? (
            <Button asChild variant="link" size="inline" touch>
              <Link
                to="/properties/$propertyId/goals/$goalId"
                params={{ propertyId: accounts.propertyId, goalId: target.programId }}
              >
                Change
              </Link>
            </Button>
          ) : (
            <Button asChild variant="link" size="inline" touch>
              <Link
                to="/properties/$propertyId/goals/portals"
                params={{ propertyId: accounts.propertyId }}
                search={{ add: 'portal', subject: `portal:${member.portalId}` }}
              >
                Set
              </Link>
            </Button>
          )
        ) : null}
      </StaffPersonValue>
      <FormErrorBanner error={goal.error} />
    </DescriptionItem>
  )
}
