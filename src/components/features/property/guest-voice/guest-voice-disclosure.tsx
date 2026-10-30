import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'

/** Show less follows the revealed content; closed descendants leave the tab order. */
export function GuestVoiceDisclosure({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {!open ? (
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between whitespace-normal text-left"
          >
            {label}
            <ChevronDown aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
      ) : null}
      <CollapsibleContent>
        {children}
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost">
            Show less<span className="sr-only"> · {label}</span>
          </Button>
        </CollapsibleTrigger>
      </CollapsibleContent>
    </Collapsible>
  )
}
