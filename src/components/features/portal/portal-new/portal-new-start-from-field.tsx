// New portal — what to start from: the Property's own welcome wording, or a
// copy of another portal's wording, links and languages. A copy never takes
// codes. The copy choice is left out while the Property has no other portal.
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { NewPortalFormValues } from '#/contexts/portal/application/dto/create-portal.dto'
import type { PortalNewSource } from './portal-new-types'

type StartFrom = NewPortalFormValues['startFrom']

export function PortalNewStartFromField({
  propertyName,
  sources,
  startFrom,
  sourcePortalId,
  sourceError,
  disabled,
  onStartFromChange,
  onSourceChange,
}: Readonly<{
  propertyName: string
  sources: readonly PortalNewSource[]
  startFrom: StartFrom
  sourcePortalId: string
  sourceError: string | null
  disabled: boolean
  onStartFromChange: (next: StartFrom) => void
  onSourceChange: (next: string) => void
}>) {
  const copying = startFrom === 'portal'
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-2 text-sm leading-snug font-medium">Start from</legend>
      <RadioGroup
        value={startFrom}
        onValueChange={(next) =>
          onStartFromChange(next === 'portal' ? 'portal' : 'property')
        }
        disabled={disabled}
        className="grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <div className="flex items-start gap-2">
          <RadioGroupItem
            value="property"
            id="portal-new-start-property"
            className="mt-1"
          />
          <Label
            htmlFor="portal-new-start-property"
            className="flex flex-col items-start gap-0.5"
          >
            {propertyName ? `${propertyName}'s wording` : 'The property’s wording'}
            <span className="text-sm leading-snug font-normal text-muted-foreground">
              The property&apos;s welcome line, yours to edit
            </span>
          </Label>
        </div>
        {sources.length > 0 ? (
          <div className="flex items-start gap-2">
            <RadioGroupItem
              value="portal"
              id="portal-new-start-portal"
              className="mt-1"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Label htmlFor="portal-new-start-portal">A copy of another portal</Label>
              {copying ? (
                <Select
                  value={sourcePortalId}
                  onValueChange={onSourceChange}
                  disabled={disabled}
                >
                  <SelectTrigger
                    aria-label="Portal to copy"
                    aria-invalid={sourceError !== null}
                    className="mt-1 w-full"
                  >
                    <SelectValue placeholder="Choose a portal" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.portalId} value={source.portalId}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {sourceError ? (
                <p role="alert" className="text-sm text-negative">
                  {sourceError}
                </p>
              ) : null}
              <span className="text-sm text-muted-foreground">
                Wording, links and languages. Never codes.
              </span>
            </div>
          </div>
        ) : null}
      </RadioGroup>
    </fieldset>
  )
}
