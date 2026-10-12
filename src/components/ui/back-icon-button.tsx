import { ArrowLeft } from 'lucide-react'
import { IconButton, type IconButtonProps } from '#/components/ui/icon-button'
import { cn } from '#/lib/utils'

// The back control when the row has no room for words (the Inbox's detail pane): the
// arrow alone, the label its name and its tooltip. It is the same arrow and the same
// ghost Button as `BackLink` and `BackButton` (`back-link.tsx`); it lives apart because
// it brings the tooltip with it, and `BackLink` is part of the first-paint closure.

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
    <IconButton {...props} size="icon-sm" className={cn(flush && '-ml-2.5', className)}>
      <ArrowLeft />
    </IconButton>
  )
}

export { BackIconButton }
export type { BackIconButtonProps }
