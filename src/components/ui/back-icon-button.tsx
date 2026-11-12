import { ArrowLeft } from 'lucide-react'
import { IconButton, type IconButtonProps } from '#/components/ui/icon-button'
import { cn } from '#/lib/utils'

// The back control when the row has no room for words: the arrow alone, the label its
// name and its tooltip. Same arrow and ghost Button as `BackLink` and `BackButton`
// (`back-link.tsx`); apart because it brings the tooltip, and `BackLink` is in the
// first-paint closure.

type BackIconButtonProps = Omit<IconButtonProps, 'children' | 'size' | 'variant'> &
  Readonly<{
    /**
     * Pull the button into the padding beside it, so the arrow rather than the
     * 36 px box sits on the content edge (a square button has more margin around
     * its arrow than a text one).
     */
    flush?: boolean
  }>

function BackIconButton({ flush, className, ...props }: BackIconButtonProps) {
  return (
    <IconButton
      {...props}
      size="icon-sm"
      className={cn(flush && '-ml-2.5 max-md:-ml-3.5', className)}
    >
      <ArrowLeft />
    </IconButton>
  )
}

export { BackIconButton }
export type { BackIconButtonProps }
