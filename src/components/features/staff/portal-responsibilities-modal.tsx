import { useMemo, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { PortalSelector, type PortalOption } from './portal-selector'
import type { UpdatePortalResponsibilitiesMutationInput } from '#/components/features/staff/types'

type Props = Readonly<{
  staffParticipationId: string
  displayName: string
  currentPrimaryPortalId: string | null
  currentSupportingPortalIds: ReadonlyArray<string>
  expectedRevision: number
  allPortals: ReadonlyArray<PortalOption>
  updateAction: Action<{ data: UpdatePortalResponsibilitiesMutationInput }>
  onOpenChange: (open: boolean) => void
}>

export function PortalResponsibilitiesModal({
  staffParticipationId,
  displayName,
  currentPrimaryPortalId,
  currentSupportingPortalIds,
  expectedRevision,
  allPortals,
  updateAction,
  onOpenChange,
}: Props) {
  const [primaryPortalId, setPrimaryPortalId] = useState(currentPrimaryPortalId ?? '')
  const [supportingPortalIds, setSupportingPortalIds] = useState<string[]>([
    ...currentSupportingPortalIds,
  ])

  const supportingOptions = allPortals.filter((portal) => portal.id !== primaryPortalId)
  const supportingField = useMemo(
    () => ({
      state: {
        value: supportingPortalIds,
        meta: { isTouched: false, isValid: true, errors: [] },
      },
      handleChange: setSupportingPortalIds,
    }),
    [supportingPortalIds],
  )
  const hasChanges =
    primaryPortalId !== (currentPrimaryPortalId ?? '') ||
    supportingPortalIds.length !== currentSupportingPortalIds.length ||
    supportingPortalIds.some((id) => !currentSupportingPortalIds.includes(id))

  const handleSave = async () => {
    if (!primaryPortalId) return
    await updateAction({
      data: {
        staffParticipationId,
        primaryPortalId,
        supportingPortalIds,
        expectedRevision,
      },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Portal responsibilities — {displayName}</DialogTitle>
          <DialogDescription>
            Choose one primary portal and any supporting portals. Responsibilities do not
            grant property access.
          </DialogDescription>
        </DialogHeader>

        {allPortals.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No portals are available at this property.
          </p>
        ) : (
          <div className="space-y-5 py-2">
            <Field>
              <FieldLabel htmlFor="primary-portal">Primary portal</FieldLabel>
              <Select
                value={primaryPortalId}
                onValueChange={(value) => {
                  setPrimaryPortalId(value)
                  setSupportingPortalIds((ids) => ids.filter((id) => id !== value))
                }}
              >
                <SelectTrigger id="primary-portal">
                  <SelectValue placeholder="Select the primary portal" />
                </SelectTrigger>
                <SelectContent>
                  {allPortals.map((portal) => (
                    <SelectItem key={portal.id} value={portal.id}>
                      {portal.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <PortalSelector
              field={supportingField}
              portals={supportingOptions}
              label="Supporting portals (optional)"
            />
          </div>
        )}

        <FormErrorBanner error={updateAction.error} />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updateAction.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!primaryPortalId || !hasChanges || updateAction.isPending}
          >
            {updateAction.isPending ? 'Saving…' : 'Save responsibilities'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
