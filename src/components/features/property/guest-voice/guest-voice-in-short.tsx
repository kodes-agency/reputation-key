import { Heart, TrendingUp, type LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { TONE_FILL, TONE_ICON, TONE_INK, type Tone } from '#/components/ui/tone'
import type { InShortLine } from '#/contexts/ai/application/public-api'
import { splitLead } from './guest-voice-words'

type LineLook = Readonly<{ icon: LucideIcon; tone: Tone; word: string }>

// The icon and the tone say what kind of line it is; `word` says it to a screen reader,
// so the kind is never carried by the colour alone.
const LOOK: Readonly<Record<InShortLine['kind'], LineLook>> = {
  fix_first: { icon: TONE_ICON.negative, tone: 'negative', word: 'Problem' },
  protect: { icon: Heart, tone: 'positive', word: 'Strength' },
  change: { icon: TrendingUp, tone: 'warn', word: 'Change' },
}

function ShortLine({ line }: Readonly<{ line: InShortLine }>) {
  const { icon: Icon, tone, word } = LOOK[line.kind]
  const { lead, rest } = splitLead(line.text)
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-3">
      <span
        className={`mt-0.5 grid size-6 place-items-center rounded-md ${TONE_FILL[tone]} ${TONE_INK[tone]}`}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">{word}: </span>
      </span>
      <p className="text-[15px] leading-snug">
        {lead === null ? line.text : <strong className="font-semibold">{lead}</strong>}
        {lead === null ? null : `:${rest}`}
      </p>
    </li>
  )
}

/**
 * The page in up to three lines: the top problem, the top strength, anything new. Each
 * is a fixed sentence pattern filled from the analysis data, so there is no model in it
 * and no wording the numbers below could contradict.
 */
export function GuestVoiceInShort({
  lines,
}: Readonly<{ lines: readonly InShortLine[] }>) {
  const headingId = useId()
  if (lines.length === 0) return null
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold tracking-tight">
        In short
      </h2>
      <ul className="flex max-w-3xl flex-col gap-3">
        {lines.map((line) => (
          <ShortLine key={`${line.kind}:${line.issueId ?? line.topic}`} line={line} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Written from the AI analysis of your reviews.
      </p>
    </section>
  )
}
