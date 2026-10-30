import type { ComponentProps } from 'react'
import { createLink } from '@tanstack/react-router'
import { inlineLinkClass } from './inline-link'
function TouchAnchor({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot="inline-link"
      className={inlineLinkClass({
        className: `inline-flex items-center max-md:min-h-(--control-touch) ${className ?? ''}`,
      })}
      {...props}
    />
  )
}
/** A standalone InlineLink with the shared phone touch height. Kept out of first paint. */
export const TouchInlineLink = createLink(TouchAnchor)
