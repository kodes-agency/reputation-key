import type { ComponentProps } from 'react'
import { createLink } from '@tanstack/react-router'
import { inlineLinkClass } from './inline-link'
function TouchAnchor({
  className,
  underline,
  ...props
}: ComponentProps<'a'> & Readonly<{ underline?: 'hover' | 'always' }>) {
  return (
    <a
      data-slot="inline-link"
      className={inlineLinkClass({
        underline,
        className: `inline-flex items-center max-md:min-h-(--control-touch) ${className ?? ''}`,
      })}
      {...props}
    />
  )
}
/** A standalone InlineLink with the shared phone touch height. Kept out of first paint. */
export const TouchInlineLink = createLink(TouchAnchor)
