// The note under a language's own words (final design spec §5.8; board
// share-words-states panels 5 to 7 and 12): a clear offer blocks the print
// ("Remove the offer to print"), mood, pressure, privacy and a lone "free" warn
// and never block, with "Use ‘How did we do?’" and "Keep my words", and a time
// in changed words gets a quiet note to keep it true. "Keep my words" puts the
// warning away for the words as they stand; changing them can raise it again.

import { Info } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  printFinalWarningNote,
  printFinalWordsWarning,
} from '#/shared/domain/portal-print-final-warnings'
import type { PrintFinalSharePrint } from './print-final-state'
import type { PrintFinalWordsState } from './use-print-final-words'

type Props = Readonly<{
  words: PrintFinalWordsState
  print: PrintFinalSharePrint
  locale: GuestLocale
}>

export function PrintFinalWordsNote({ words, print, locale }: Props) {
  // The words a warning was put away for, as they stood then.
  const [kept, setKept] = useState<string | null>(null)
  const warning = printFinalWordsWarning(print.words, locale)
  if (warning === null) return null
  const note = printFinalWarningNote(warning)
  const copy = print.words.custom?.[locale]
  const current = `${copy?.headline ?? ''}\n${copy?.subline ?? ''}`
  if (warning.kind === 'time') {
    // Once per print: the first language that promises a time says it.
    const first = print.languages.find(
      (each) => printFinalWordsWarning(print.words, each)?.kind === 'time',
    )
    if (first !== locale) return null
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        {note.title}
      </p>
    )
  }
  if (warning.kind === 'warn' && kept === current) return null
  return (
    <Alert
      variant={warning.kind === 'block' ? 'destructive' : 'warning'}
      className="mt-2"
    >
      <AlertTitle className="line-clamp-none">{note.title}</AlertTitle>
      <AlertDescription>
        {note.body}
        {(note.offersDefault || note.offersKeep) && (
          <span className="mt-1.5 flex flex-wrap gap-2">
            {note.offersDefault && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => words.pick('how_did_we_do')}
              >
                Use “How did we do?”
              </Button>
            )}
            {note.offersKeep && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setKept(current)}
              >
                Keep my words
              </Button>
            )}
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}
