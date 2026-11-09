import { cn } from '#/lib/utils'

// A loading block draws the border grey, not `bg-accent`: that is the purple tint
// `--accent-muted`, 1.03:1 on a dark card, which made the loading state vanish.
function Skeleton({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & { variant?: 'reply-body' }) {
  return (
    <div
      data-slot="skeleton"
      data-variant={variant}
      className={cn('animate-pulse rounded-md bg-border', className)}
      {...props}
    />
  )
}

export { Skeleton }
