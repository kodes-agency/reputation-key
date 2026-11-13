import * as React from 'react'

import { cn } from '#/lib/utils'
import { PopoverTrigger } from '#/components/ui/popover'

/**
 * The cue that text explains itself when asked: a dotted underline in the text's own
 * colour. Text that is interactive without being a link wears this line everywhere. A
 * caller adds only what is its own, such as a solid line while open.
 */
export const EXPLAIN_UNDERLINE =
  'underline decoration-dotted decoration-from-font underline-offset-4'

/**
 * The trigger of an explanation: a real button with the cue, the help cursor and the
 * shared focus ring. A Popover rather than a hover Tooltip on purpose: the explanation
 * has to be reachable by keyboard and on a phone. A trigger that is not plain text
 * draws its own box and puts `EXPLAIN_UNDERLINE` on the words.
 */
function ExplainTrigger({
  className,
  touch = false,
  ...props
}: React.ComponentProps<typeof PopoverTrigger> & { touch?: boolean }) {
  return (
    <PopoverTrigger
      data-slot="explain-trigger"
      className={cn(
        'cursor-help rounded focus-ring',
        EXPLAIN_UNDERLINE,
        touch && 'max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)',
        className,
      )}
      {...props}
    />
  )
}

export { ExplainTrigger }
