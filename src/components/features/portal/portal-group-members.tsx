import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type {
  PortalGroupMutations,
  PortalGroupView,
  PortalOption,
} from './portal-group-types'

type Props = Readonly<{
  group: PortalGroupView
  portalById: ReadonlyMap<string, PortalOption>
  eligiblePortals: readonly PortalOption[]
  canUpdate: boolean
  addPortalMutation: PortalGroupMutations['addPortalMutation']
  removePortalMutation: PortalGroupMutations['removePortalMutation']
}>

export function PortalGroupMembers({
  group,
  portalById,
  eligiblePortals,
  canUpdate,
  addPortalMutation,
  removePortalMutation,
}: Props) {
  const [selectedPortalId, setSelectedPortalId] = useState('')

  return (
    <>
      {group.portalIds.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={`${group.name} portals`}>
          {group.portalIds.map((portalId) => (
            <li
              key={portalId}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">
                {portalById.get(portalId)?.name ?? 'Unavailable portal'}
              </span>
              {canUpdate && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${portalById.get(portalId)?.name ?? 'portal'} from ${group.name}`}
                  disabled={removePortalMutation.isPending}
                  onClick={() => {
                    void removePortalMutation({
                      data: { portalGroupId: group.id, portalId },
                    }).catch(() => undefined)
                  }}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No portals in this group.</p>
      )}

      {canUpdate && eligiblePortals.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor={`add-portal-${group.id}`}>Add a portal</Label>
            <Select value={selectedPortalId} onValueChange={setSelectedPortalId}>
              <SelectTrigger
                id={`add-portal-${group.id}`}
                className="min-h-11 w-full sm:min-h-9"
              >
                <SelectValue placeholder="Select an ungrouped portal" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {eligiblePortals.map((portal) => (
                    <SelectItem key={portal.id} value={portal.id}>
                      {portal.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={!selectedPortalId || addPortalMutation.isPending}
            onClick={() => {
              if (!selectedPortalId) return
              void addPortalMutation({
                data: { portalGroupId: group.id, portalId: selectedPortalId },
              })
                .then(() => setSelectedPortalId(''))
                .catch(() => undefined)
            }}
          >
            {addPortalMutation.isPending ? 'Adding…' : 'Add portal'}
          </Button>
        </div>
      )}

      {canUpdate && eligiblePortals.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No eligible portals remain. Remove a portal from another group before adding it
          here.
        </p>
      )}
    </>
  )
}
