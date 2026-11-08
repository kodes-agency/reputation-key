import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { RowButton as Button } from '#/components/ui/button-layouts'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'

/** One stable trigger retains focus while its descendants enter or leave the tab order. */
export function GuestVoiceDisclosure({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" aria-expanded={open}>
          {open ? (
            <>
              Show less<span className="sr-only"> · {label}</span>
            </>
          ) : (
            label
          )}
          <ChevronDown aria-hidden="true" className={open ? 'rotate-180' : undefined} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
