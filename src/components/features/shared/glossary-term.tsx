// A dashboard term that carries its definition (redesign row 11).
//
// A Popover rather than a hover Tooltip on purpose: the definition has to be
// reachable by keyboard and on a phone, where there is no hover. The trigger is
// a real button with a dotted underline — the one place in the dashboard where
// text is interactive without being a link.
import { DASHBOARD_GLOSSARY, type GlossaryTermKey } from '#/shared/dashboard-glossary'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'

type Props = Readonly<{
  term: GlossaryTermKey
  /** Overrides the rendered word when the sentence needs another form
   *  ("complaints" inside a column header, say). The definition is unchanged. */
  children?: string
}>

export function GlossaryTerm({ term, children }: Props) {
  const entry = DASHBOARD_GLOSSARY[term]
  const label = children ?? entry.term

  return (
    <Popover>
      <PopoverTrigger
        className="cursor-help rounded underline decoration-dotted decoration-from-font underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`What ${label.toLowerCase()} means`}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm">
        <p className="font-medium">{entry.term}</p>
        <p className="mt-1 text-muted-foreground">{entry.definition}</p>
      </PopoverContent>
    </Popover>
  )
}
