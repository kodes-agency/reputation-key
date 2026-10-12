// The title of a section of a page that is not a Card (UI consistency scan: FORM-10,
// FRAME-10): Members and Pending invitations, Data handling and risks, Quiet hours'
// two parts. A `CardTitle` titles a Card; this titles everything else, at the same
// scale, so a settings page has two sizes of title and not five.
//
// The level is the outline, the size is the scale: an h2 is a section under the page's
// one h1 (`text-base`, semibold), an h3 is a part of a section (`text-sm`, medium). A
// part is never the first heading under the h1.
import type { ComponentProps } from 'react'
import { cn } from '#/lib/utils'

const LEVEL = {
  2: { tag: 'h2', className: 'text-base font-semibold' },
  3: { tag: 'h3', className: 'text-sm font-medium' },
} as const

type Props = Omit<ComponentProps<'h2'>, 'ref'> & { level?: keyof typeof LEVEL }

export function SectionTitle({ level = 2, className, ...props }: Props) {
  const { tag: Tag, className: scale } = LEVEL[level]
  return <Tag data-slot="section-title" className={cn(scale, className)} {...props} />
}
