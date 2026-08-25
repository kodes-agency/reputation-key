import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, UserRoundCheck } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import {
  normalizeResponsibleManagerIds as sorted,
  reconcileResponsibleManagerSelection,
  sameResponsibleManagerIds as sameIds,
} from '#/components/features/responsible-managers/selection'

export type PropertyResponsibleManagerState = Readonly<{
  assignments: readonly Readonly<{ userId: string }>[]
  eligibleManagers: readonly Readonly<{
    userId: string
    role: 'AccountAdmin' | 'PropertyManager'
  }>[]
  revision: number
  responsibilityNeeded: boolean
  responsibilityNeededSince: string | Date | null
}>

export type ResponsibleManagerMember = Readonly<{
  userId: string
  name: string
  email: string
  role: string | null
}>

type UpdateInput = Readonly<{
  data: {
    propertyId: string
    managerUserIds: string[]
    expectedRevision: number
  }
}>

export function PropertyResponsibleManagersCard({
  propertyId,
  state,
  members,
  updateAction,
  disabled,
}: Readonly<{
  propertyId: string
  state: PropertyResponsibleManagerState
  members: readonly ResponsibleManagerMember[]
  updateAction: Action<UpdateInput>
  disabled: boolean
}>) {
  const serverSelection = sorted(state.assignments.map((row) => row.userId))
  const serverSignature = serverSelection.join('\u0000')
  const priorServerSelection = useRef(serverSelection)
  const [selected, setSelected] = useState(serverSelection)

  useEffect(() => {
    const prior = priorServerSelection.current
    setSelected((current) =>
      reconcileResponsibleManagerSelection(current, prior, serverSelection),
    )
    priorServerSelection.current = serverSelection
  }, [serverSignature])

  const eligibleIds = useMemo(
    () => new Set(state.eligibleManagers.map((manager) => manager.userId)),
    [state.eligibleManagers],
  )
  const assignedIds = new Set(state.assignments.map((row) => row.userId))
  const options = members.filter(
    (member) => eligibleIds.has(member.userId) || assignedIds.has(member.userId),
  )
  const dirty = !sameIds(sorted(selected), serverSelection)

  const save = async () => {
    await updateAction({
      data: {
        propertyId,
        managerUserIds: sorted(selected),
        expectedRevision: state.revision,
      },
    })
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <UserRoundCheck className="size-4" aria-hidden="true" />
          <h2 className="font-semibold">Responsible managers</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          These assignments define who receives Property-wide operational updates.
          Responsibility does not grant Property access or Staff attribution.
        </p>
      </div>

      {(state.responsibilityNeeded || selected.length === 0) && (
        <Alert>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Property responsible manager needed</AlertTitle>
          <AlertDescription>
            Assign at least one manager so Property-wide updates have a clear owner.
            Account admins remain available for recovery.
          </AlertDescription>
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
                id={`property-responsible-manager-${member.userId}`}
                checked={checked}
                disabled={disabled || updateAction.isPending || (!eligible && !checked)}
                onCheckedChange={(next) =>
                  setSelected((current) =>
                    next === true
                      ? sorted([...current, member.userId])
                      : current.filter((id) => id !== member.userId),
                  )
                }
              />
              <Label
                htmlFor={`property-responsible-manager-${member.userId}`}
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

      <FormErrorBanner error={updateAction.error} />
      <div className="flex justify-end">
        <Button disabled={disabled || !dirty || updateAction.isPending} onClick={save}>
          {updateAction.isPending ? 'Saving…' : 'Save responsible managers'}
        </Button>
      </div>
    </div>
  )
}
