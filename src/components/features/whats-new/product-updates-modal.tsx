import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogCancel,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import type { ProductUpdate } from '#/shared/whats-new/types'
import { UpdateEntry } from './update-entry'

type Props = Readonly<{
  highlights: readonly ProductUpdate[]
  fixes: readonly ProductUpdate[]
  propertyId: string | null
  onClose: () => void
  /** Reserved for an AccountAdmin's pending AI update; supplied by its future owner. */
  leadingItem?: ReactNode
  onReturnFocus?: () => void
}>

function Fixes({ fixes }: Pick<Props, 'fixes'>) {
  if (!fixes.length) return null
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        {/* -ml-2.5 takes back the button's own padding, so the label starts on the column's edge. */}
        <Button type="button" variant="ghost" size="sm" className="group -ml-2.5">
          Also fixed ({fixes.length})
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="list-disc space-y-2 pl-5 pt-3 text-sm text-muted-foreground">
          {fixes.map((entry) => (
            <li key={entry.id}>{entry.title}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Highlights({
  highlights,
  propertyId,
  onClose,
}: Pick<Props, 'highlights' | 'propertyId' | 'onClose'>) {
  return (
    <div className="space-y-6">
      {highlights.map((entry) => (
        <UpdateEntry
          key={entry.id}
          entry={entry}
          propertyId={propertyId}
          onFollow={onClose}
          level={2}
        />
      ))}
    </div>
  )
}

function Footer({ propertyId, onClose }: Pick<Props, 'propertyId' | 'onClose'>) {
  return (
    <DialogFooter>
      <Button variant="ghost" asChild>
        <Link to="/whats-new" search={propertyId ? { propertyId } : {}} onClick={onClose}>
          See all updates
        </Link>
      </Button>
      <DialogCancel>Close</DialogCancel>
    </DialogFooter>
  )
}

export function ProductUpdatesModal(props: Props) {
  const { fixes, onClose, leadingItem, onReturnFocus } = props
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        size="md"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          if (onReturnFocus) {
            event.preventDefault()
            onReturnFocus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>What&apos;s new</DialogTitle>
          <DialogDescription>Here is what changed recently.</DialogDescription>
        </DialogHeader>
        {leadingItem}
        <Highlights {...props} />
        <Fixes fixes={fixes} />
        <Footer {...props} />
      </DialogContent>
    </Dialog>
  )
}
