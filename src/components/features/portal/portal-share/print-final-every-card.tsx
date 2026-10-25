// "These words on every card" under the preview while the manager writes their
// own words (final design spec §5.7; boards share-words-custom and
// share-words-states panel 9): each piece, wide then upright, with a tick or a
// cross from the same planner, so a manager who prints several kinds sees which
// one would refuse the words.

import { Check, X } from 'lucide-react'
import { printFinalEveryCardLine } from '#/shared/domain/portal-print-final-words-copy'
import type { PrintFinalSharePrint } from './print-final-state'
import type { PrintFinalWordsState } from './use-print-final-words'

type Props = Readonly<{ words: PrintFinalWordsState; print: PrintFinalSharePrint }>

export function PrintFinalEveryCard({ words, print }: Props) {
  const rows = words.own?.everyCard
  if (!words.isOwn || rows === undefined) return null
  return (
    <section aria-labelledby="print-final-every-card" className="flex flex-col gap-2">
      <h3 id="print-final-every-card" className="text-[13px] font-semibold">
        These words on every card
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const { name, detail } = printFinalEveryCardLine(row, print.languages)
          const refused = row.state === 'refused'
          const Icon = refused ? X : Check
          return (
            <li
              key={`${row.piece}-${row.orientation}`}
              className="flex items-start gap-2 text-[13px]"
            >
              <Icon
                aria-label={refused ? 'Too long' : 'Fits'}
                className={`mt-0.5 size-3.5 shrink-0 ${refused ? 'text-negative' : 'text-positive'}`}
              />
              <span>
                {name} <span className="text-muted-foreground">· {detail}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
