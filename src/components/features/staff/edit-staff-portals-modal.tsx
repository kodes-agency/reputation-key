/**
 * EditStaffPortalsModal — dialog for editing a staff member's portal assignments.
 */

import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { PortalSelector, type PortalOption } from './portal-selector'
import type { Action } from '#/components/hooks/use-action'

type UpdateStaffPortalsInput = {
  data: { userId: string; propertyId: string; portalIds: string[] }
}

type Props = Readonly<{
  userId: string
  userName: string
  propertyId: string
  currentPortalIds: string[]
  allPortals: ReadonlyArray<PortalOption>
  updateAction: Action<UpdateStaffPortalsInput>
  open: boolean
  onOpenChange: (open: boolean) => void
}>

export function EditStaffPortalsModal({
  userId,
  userName,
  propertyId,
  currentPortalIds,
  allPortals,
  updateAction,
  open,
  onOpenChange,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(currentPortalIds)

  // Reset selection when modal opens with new data
  const [prevOpen, setPrevOpen] = useState(false)
  if (open && !prevOpen) {
    setPrevOpen(true)
    if (
      selectedIds.length !== currentPortalIds.length ||
      !currentPortalIds.every((id) => selectedIds.includes(id))
    ) {
      setSelectedIds(currentPortalIds)
    }
  }
  if (!open && prevOpen) {
    setPrevOpen(false)
  }

  // Synthetic field for PortalSelector (which expects TanStack form field interface)
  const syntheticField = useMemo(
    () => ({
      state: {
        value: selectedIds,
        meta: {
          isTouched: true,
          isValid: selectedIds.length > 0,
          errors:
            selectedIds.length === 0 ? [{ message: 'Select at least one portal' }] : [],
        },
      },
      handleChange: (value: string[]) => setSelectedIds(value),
    }),
    [selectedIds],
  )

  const hasChanges =
    selectedIds.length !== currentPortalIds.length ||
    !currentPortalIds.every((id) => selectedIds.includes(id))

  const handleSave = async () => {
    if (selectedIds.length === 0) return
    await updateAction({
      data: { userId, propertyId, portalIds: selectedIds },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Portals — {userName}</DialogTitle>
          <DialogDescription>
            Select which portals {userName} should have access to.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <PortalSelector field={syntheticField} portals={allPortals} />
        </div>

        {updateAction.error != null && (
          <p className="text-sm text-destructive">
            {updateAction.error instanceof Error
              ? updateAction.error.message
              : 'Failed to update portals'}
          </p>
        )}

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
            disabled={selectedIds.length === 0 || !hasChanges || updateAction.isPending}
          >
            {updateAction.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
