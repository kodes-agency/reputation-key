import { useMemo } from 'react'
import { UserRoundCheck } from 'lucide-react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import {
  normalizeResponsibleManagerIds as sorted,
  sameResponsibleManagerIds as sameIds,
} from './selection'
import { useResponsibleManagerSelection } from './use-responsible-manager-selection'

export type ResponsibleManagersPanelState = Readonly<{
  assignments: readonly Readonly<{ userId: string }>[]
  eligibleManagers: readonly Readonly<{ userId: string }>[]
  revision: number
  responsibilityNeeded: boolean
}>

export type ResponsibleManagersPanelMember = Readonly<{
  userId: string
  name: string
  email: string
}>

export type ResponsibleManagersPanelCopy = Readonly<{
  description: string
  alertTitle: string
  alertDescription: string
}>

/**
 * Shared presentation for the Portal and Property "responsible managers"
 * cards (code-health-09): identical assignment UI and "at least one manager"
 * empty-state, differing only in the id key they save against, the heading
 * level required by the page they sit in, and their copy. Pure and
 * container-agnostic on purpose (`onSave`/`isPending`/`error` instead of the
 * `Action` object each caller already has) — see
 * ResponsibleManagersCard and PropertyResponsibleManagersCard for the two
 * container wrappers that adapt this to their own `updateAction`.
 */
export function ResponsibleManagersPanel({
  state,
  members,
  disabled,
  isPending,
  error,
  headingLevel,
  idPrefix,
  copy,
  onSave,
}: Readonly<{
  state: ResponsibleManagersPanelState
  members: readonly ResponsibleManagersPanelMember[]
  disabled: boolean
  isPending: boolean
  error: unknown
  headingLevel: 'h2' | 'h3'
  idPrefix: string
  copy: ResponsibleManagersPanelCopy
  onSave: (
    managerUserIds: readonly string[],
    expectedRevision: number,
  ) => Promise<unknown>
}>) {
  const { selected, setSelected, serverSelection } = useResponsibleManagerSelection(
    state.assignments,
  )

  const eligibleIds = useMemo(
    () => new Set(state.eligibleManagers.map((manager) => manager.userId)),
    [state.eligibleManagers],
  )
  const assignedIds = new Set(state.assignments.map((row) => row.userId))
  const options = members.filter(
    (member) => eligibleIds.has(member.userId) || assignedIds.has(member.userId),
  )
  const dirty = !sameIds(sorted(selected), serverSelection)

  // The banner shows a refusal from the Action's own error; settling here keeps
  // it from escaping the click as an unhandled rejection (errors-01).
  const save = () => {
    void onSave(sorted(selected), state.revision).catch(() => undefined)
  }

  const Heading = headingLevel

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <UserRoundCheck className="size-4" aria-hidden="true" />
          <Heading className="font-semibold">Responsible managers</Heading>
        </div>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
      </div>

      {(state.responsibilityNeeded || selected.length === 0) && (
        <Alert variant="warning">
          <AlertTitle>{copy.alertTitle}</AlertTitle>
          <AlertDescription>{copy.alertDescription}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        {options.map((member) => {
          const checked = selected.includes(member.userId)
          const eligible = eligibleIds.has(member.userId)
          return (
            <div
              key={member.userId}
              className="flex items-start gap-3 rounded-md border p-3"
            >
              <Checkbox
                id={`${idPrefix}-${member.userId}`}
                checked={checked}
                disabled={disabled || isPending || (!eligible && !checked)}
                onCheckedChange={(next) =>
                  setSelected((current) =>
                    next === true
                      ? sorted([...current, member.userId])
                      : current.filter((id) => id !== member.userId),
                  )
                }
              />
              <Label
                htmlFor={`${idPrefix}-${member.userId}`}
                className="flex min-w-0 flex-1 flex-col font-normal"
              >
                <span className="font-medium">{member.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {member.email}
                  {!eligible && checked
                    ? ' · Eligibility changed; remove this assignment'
                    : ''}
                </span>
              </Label>
            </div>
          )
        })}
        {options.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No eligible managers are currently available for this Property.
          </p>
        )}
      </div>

      <FormErrorBanner error={error} />
      <div className="flex justify-end">
        <Button
          pending={isPending}
          pendingLabel="Saving…"
          disabled={disabled || !dirty}
          onClick={save}
        >
          Save responsible managers
        </Button>
      </div>
    </div>
  )
}
