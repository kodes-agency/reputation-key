// One option of the replace-code choice: a radio with its title and what it means.

import { Label } from '#/components/ui/label'
import { RadioGroupItem } from '#/components/ui/radio-group'

export function PortalReplacementChoice({
  value,
  title,
  description,
}: Readonly<{ value: 'planned' | 'security'; title: string; description: string }>) {
  const id = `portal-replacement-${value}`
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <Label htmlFor={id} className="flex flex-col items-start gap-1 font-normal">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </Label>
    </div>
  )
}
