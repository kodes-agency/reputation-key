import * as React from 'react'

import { cn } from '#/lib/utils'
import { PopoverTrigger } from '#/components/ui/popover'

/**
 * The cue that text explains itself when asked: a dotted underline in the text's
 * own colour. It is the one place in the dashboard where text is interactive
 * without being a link, so every explainable word wears the same line (a glossary
 * term, the Google source details, the Inbox due chip, a withheld figure, a Portal's
 * issues). A caller adds only what is its own, such as a solid line while open.
 */
export const EXPLAIN_UNDERLINE =
  'underline decoration-dotted decoration-from-font underline-offset-4'

/**
 * The trigger of an explanation: a real button with the cue, the help cursor and
 * the shared focus ring. A Popover rather than a hover Tooltip on purpose: the
 * explanation has to be reachable by keyboard and on a phone, where there is no
 * hover. A trigger that is not plain text (the Inbox due chip has an icon) draws
 * its own box and puts `EXPLAIN_UNDERLINE` on the words.
 */
function ExplainTrigger({
  className,
  ...props
}: React.ComponentProps<typeof PopoverTrigger>) {
  return (
    <PopoverTrigger
      data-slot="explain-trigger"
      className={cn('cursor-help rounded focus-ring', EXPLAIN_UNDERLINE, className)}
      {...props}
    />
  )
}

export { ExplainTrigger }
