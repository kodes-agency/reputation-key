import * as React from 'react'

import { cn } from '#/lib/utils'
import { PopoverTrigger } from '#/components/ui/popover'
import { PHONE_TOUCH_PAD } from './touch-pad'

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
        // Set in a sentence it keeps the line's own box and wears a 44 px pad on a
        // phone; `touch` is for one that stands on its own.
        touch
          ? 'max-md:min-h-(--control-touch) max-md:min-w-(--control-touch)'
          : PHONE_TOUCH_PAD,
        className,
      )}
      {...props}
    />
  )
}

export { ExplainTrigger }
