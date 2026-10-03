import { cn } from '#/lib/utils'

// A loading block draws the border grey, not `bg-accent`: that is the purple
// tint `--accent-muted`, which is 1.03:1 on a dark card and made the loading
// state vanish. The pairing is measured in `token-contrast.test.ts`.
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-border', className)}
      {...props}
    />
  )
}

export { Skeleton }
