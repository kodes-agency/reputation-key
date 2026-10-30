import type { ComponentProps } from 'react'
import { Badge } from './badge'
import { cn } from '#/lib/utils'
/** Body-sized chips for evidence that must stay readable on phones. */
export function ReadableBadge({ className, ...props }: ComponentProps<typeof Badge>) {
  return <Badge {...props} className={cn('text-sm', className)} />
}
