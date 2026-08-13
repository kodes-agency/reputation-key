import { useEffect, useState } from 'react'
import { Crown } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { TeamMembershipView } from '#/components/features/team/shared/types'

type Props = Readonly<{
  teamId: string
  memberships: ReadonlyArray<TeamMembershipView>
  setLeadAction: Action<{ data: { teamId: string; staffParticipationId: string } }>
  clearLeadAction: Action<{ data: { teamId: string; reason?: string } }>
}>

export function TeamLeadControls({
  teamId,
  memberships,
  setLeadAction,
  clearLeadAction,
}: Props) {
  const activeMemberships = memberships.filter(
    (membership) => membership.effectiveTo == null,
  )
  const currentLead = activeMemberships.find((membership) => membership.role === 'lead')
  const [selectedId, setSelectedId] = useState(currentLead?.staffParticipationId ?? '')
  useEffect(() => {
    setSelectedId(currentLead?.staffParticipationId ?? '')
  }, [currentLead?.staffParticipationId])
  const isPending = setLeadAction.isPending || clearLeadAction.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="size-4 text-muted-foreground" aria-hidden="true" />
          Team lead
        </CardTitle>
        <CardDescription>
          The lead may add or remove non-lead members. Lead changes remain manager-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeMemberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a member before appointing a team lead.
          </p>
        ) : (
          <Field>
            <FieldLabel htmlFor="team-lead-membership">Active team member</FieldLabel>
            <Select value={selectedId} onValueChange={setSelectedId} disabled={isPending}>
              <SelectTrigger id="team-lead-membership" aria-label="Active team member">
                <SelectValue placeholder="Select a member" />
              </SelectTrigger>
              <SelectContent>
                {activeMemberships.map((membership) => (
                  <SelectItem
                    key={membership.staffParticipationId}
                    value={membership.staffParticipationId}
                  >
                    {membership.displayName}
                    {membership.role === 'lead' ? ' — current lead' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <FormErrorBanner error={setLeadAction.error ?? clearLeadAction.error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {currentLead && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                clearLeadAction({
                  data: { teamId, reason: 'Cleared from manager team settings' },
                })
              }
            >
              {clearLeadAction.isPending ? 'Clearing…' : 'Clear lead'}
            </Button>
          )}
          <Button
            type="button"
            disabled={
              isPending ||
              selectedId.length === 0 ||
              selectedId === currentLead?.staffParticipationId
            }
            onClick={() =>
              setLeadAction({ data: { teamId, staffParticipationId: selectedId } })
            }
          >
            {setLeadAction.isPending
              ? 'Saving…'
              : currentLead
                ? 'Replace lead'
                : 'Appoint lead'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
