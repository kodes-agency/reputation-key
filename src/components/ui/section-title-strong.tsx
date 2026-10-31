import type { ComponentProps } from 'react'
import { SectionTitle } from './section-title'
import { cn } from '#/lib/utils'
/** Strong evidence-section hierarchy, a lazy variant of SectionTitle. */
export function StrongSectionTitle({
  className,
  ...props
}: ComponentProps<typeof SectionTitle>) {
  return <SectionTitle {...props} className={cn('text-base font-bold', className)} />
}
