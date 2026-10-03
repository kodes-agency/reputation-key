// New portal — the two facts closing the form: whose look the page borrows, and
// who will be responsible. "Change" opens a short list of the managers eligible
// for the Property; the creator is the default when eligible. Names come from
// the member directory when the role may read it; an id is never shown.
import { Palette, UserRound } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import type { PortalManagerName } from '../portal-overview/portal-overview-view'
import { responsibleSummary, type PortalNewOptions } from './portal-new-rules'

type Props = Readonly<{
  propertyName: string
  options: PortalNewOptions
  creatorId: string
  members: readonly PortalManagerName[]
  /** Null keeps the default (the creator, when eligible). */
  choice: readonly string[] | null
  disabled: boolean
  onChoiceChange: (next: string[]) => void
}>

function managerLabel(
  userId: string,
  creatorId: string,
  members: readonly PortalManagerName[],
): string {
  if (userId === creatorId) return 'You'
  return (
    members.find((member) => member.userId === userId)?.name.trim() || 'Another manager'
  )
}

export function PortalNewResponsible({
  propertyName,
  options,
  creatorId,
  members,
  choice,
  disabled,
  onChoiceChange,
}: Props) {
  const current = choice ?? (options.creatorIsEligible ? [creatorId] : [])
  const toggle = (userId: string, on: boolean) =>
    onChoiceChange(on ? [...current, userId] : current.filter((id) => id !== userId))
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p className="flex items-center gap-2">
        <Palette aria-hidden="true" className="size-4 shrink-0" />
        <span>
          Look: the photo and colours set for all of {propertyName || 'this property'}
        </span>
      </p>
      <p className="flex flex-wrap items-center gap-x-2">
        <UserRound aria-hidden="true" className="size-4 shrink-0" />
        <span>{responsibleSummary(choice, options, creatorId, members)}</span>
        {options.eligibleManagerUserIds.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="link" size="inline" disabled={disabled}>
                Change
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-sm font-medium text-foreground">
                  Responsible for this portal
                </legend>
                {options.eligibleManagerUserIds.map((userId) => (
                  <div key={userId} className="flex items-center gap-2">
                    <Checkbox
                      id={`portal-new-manager-${userId}`}
                      checked={current.includes(userId)}
                      onCheckedChange={(checked) => toggle(userId, checked === true)}
                    />
                    <Label
                      htmlFor={`portal-new-manager-${userId}`}
                      className="font-normal"
                    >
                      {managerLabel(userId, creatorId, members)}
                    </Label>
                  </div>
                ))}
              </fieldset>
            </PopoverContent>
          </Popover>
        ) : null}
      </p>
    </div>
  )
}
