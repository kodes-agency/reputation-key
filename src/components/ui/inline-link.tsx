import type * as React from 'react'
import { createLink } from '@tanstack/react-router'

import { cn } from '#/lib/utils'

type InlineLinkOptions = Readonly<{
  /** Underlined on hover (the default), or always, for a link inside a sentence. */
  underline?: 'hover' | 'always'
  className?: string
}>

/** The class list of a link set in a sentence, for an anchor that is not a router link. */
function inlineLinkClass({
  underline = 'hover',
  className,
}: InlineLinkOptions = {}): string {
  return cn(
    'font-medium text-link underline-offset-4',
    underline === 'always' ? 'underline' : 'hover:underline',
    className,
  )
}

function InlineAnchor({
  className,
  underline,
  ...props
}: React.ComponentProps<'a'> & Pick<InlineLinkOptions, 'underline'>) {
  return (
    <a
      data-slot="inline-link"
      className={inlineLinkClass({ underline, className })}
      {...props}
    />
  )
}

/**
 * A router link set in a sentence or beside a field: accent ink, medium weight,
 * underlined on hover (`underline="always"` for a link that has to read as one
 * without a pointer, such as the agreements under a sign-up form). A link that
 * looks like a button is a `Button` with `asChild`; a link that is only a way
 * out of a card is whatever that card's navigation is.
 */
const InlineLink = createLink(InlineAnchor)

export { InlineLink, inlineLinkClass }
