// "Write your own…" in the final Print cards section (final design spec §5.6,
// §5.7 and §8; the boards share-words-custom, share-words-two-languages,
// share-words-states and share-words-phone): a Headline and a Sub-line for each
// language on the print, prefilled from the wording, each with the planner's
// status and a counter that is a guide, never a limit. A second language's pair
// appears only with two languages and is never translated. Every status is an
// icon and words, tied to its field, and read out only when it changes.

import { CircleCheck, CircleX, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useIsBelowLarge } from '#/components/hooks/use-mobile'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import {
  PRINT_FINAL_CUSTOM_MAX_CHARACTERS,
  normalisePrintFinalText,
} from '#/shared/domain/portal-print-final-custom'
import { unsupportedCharacters } from '#/shared/domain/portal-print-kit-font-ranges'
import { PRINT_FINAL_TYPE } from '#/shared/domain/portal-print-final-type'
import {
  PRINT_FINAL_WORDS_GUIDE,
  printFinalHeadlineCounter,
  printFinalHeadlineStatus,
  printFinalSecondStatus,
  printFinalShortCounter,
  printFinalSublineStatus,
  type PrintFinalFieldStatus,
} from '#/shared/domain/portal-print-final-words-copy'
import type { PrintFinalSharePrint } from './print-final-state'
import type { PrintFinalWordsState } from './use-print-final-words'

type Props = Readonly<{ words: PrintFinalWordsState; print: PrintFinalSharePrint }>

const TONE_CLASS: Readonly<Record<PrintFinalFieldStatus['tone'], string>> = {
  positive: 'text-positive',
  neutral: 'text-muted-foreground',
  negative: 'text-negative',
}

const TONE_ICON = { positive: CircleCheck, neutral: Info, negative: CircleX } as const

const EMOJI = /\p{Extended_Pictographic}/u

/** "These characters will not print: ✓ ★", emoji named as such; null when every character prints. */
function missingCharactersNote(text: string): string | null {
  const missing = unsupportedCharacters(text)
  if (missing.length === 0) return null
  const named = [
    ...new Set(missing.map((character) => (EMOJI.test(character) ? 'emoji' : character))),
  ]
  return `These characters will not print: ${named.join(' ')}`
}

function StatusRow({
  id,
  status,
  counter,
}: Readonly<{ id: string; status: PrintFinalFieldStatus | null; counter: string }>) {
  const Icon = status === null ? null : TONE_ICON[status.tone]
  return (
    <div id={id} className="mt-1.5 grid grid-cols-[1fr_auto] items-start gap-x-4 text-xs">
      {status === null || Icon === null ? (
        <span />
      ) : (
        <span className={`flex items-start gap-1.5 ${TONE_CLASS[status.tone]}`}>
          <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            {status.text}
            {status.extra !== null && (
              <span className="block text-muted-foreground">{status.extra}</span>
            )}
          </span>
        </span>
      )}
      <span
        className={`whitespace-nowrap tabular-nums ${status?.tone === 'negative' ? 'text-negative' : 'text-muted-foreground'}`}
      >
        {counter}
      </span>
    </div>
  )
}

function Field({
  id,
  label,
  value,
  invalid,
  onChange,
  children,
}: Readonly<{
  id: string
  label: string
  value: string
  invalid: boolean
  onChange: (text: string) => void
  children: ReactNode
}>) {
  return (
    <div className="flex flex-col">
      <Label htmlFor={id} className="mb-1.5 font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        maxLength={PRINT_FINAL_CUSTOM_MAX_CHARACTERS}
        autoComplete="off"
        spellCheck
        aria-invalid={invalid}
        aria-describedby={`${id}-status`}
        // One line: Enter does nothing, and a pasted break becomes a space.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {children}
    </div>
  )
}

const length = (text: string) => [...normalisePrintFinalText(text)].length

/** The announcement for the first headline: it changes only with the state, not with each keystroke. */
function announcementOf(words: PrintFinalWordsState): string {
  const fit = words.own?.fit
  if (fit === undefined) return ''
  if (fit.state === 'refused') return 'Too long for this card, even at the smallest size'
  return fit.state === 'step' ? `Prints at ${fit.headlinePt} pt` : 'Fits at full size'
}

function LanguageFields({
  words,
  print,
  locale,
  index,
}: Props & Readonly<{ locale: GuestLocale; index: number }>) {
  const compact = useIsBelowLarge()
  const copy = print.words.custom?.[locale] ?? { headline: '', subline: '' }
  const own = words.own
  const guide = PRINT_FINAL_WORDS_GUIDE[print.piece][print.orientation]
  const two = print.languages.length > 1
  const id = `print-final-own-${locale}`
  const first = index === 0
  const headlineStatus =
    own === null
      ? null
      : first
        ? printFinalHeadlineStatus(
            print,
            own.fit,
            own.shortenBy,
            length(copy.headline),
            print.languages.length,
          )
        : printFinalSecondStatus(
            own.fit,
            print.languages[0] ?? 'en',
            PRINT_FINAL_TYPE[print.piece].secondHeadlinePt,
          )
  const sublineLines = first ? own?.fit.sublineLines : own?.fit.secondSublineLines
  const sublineStatus: PrintFinalFieldStatus | null =
    own === null
      ? null
      : !first && own.fit.secondMode === 'line'
        ? { tone: 'neutral', text: 'Upright pieces print the headline only', extra: null }
        : printFinalSublineStatus(length(copy.subline), {
            ...own.fit,
            sublineLines: sublineLines ?? 0,
          })
  const missing = missingCharactersNote(`${copy.headline} ${copy.subline}`)
  const headlineCounter = first
    ? printFinalHeadlineCounter(
        print,
        length(copy.headline),
        print.languages.length,
        compact,
      )
    : printFinalShortCounter(length(copy.headline), guide.secondHeadline)
  return (
    <div className="flex flex-col gap-3">
      {two && (
        <p className="text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">
            {GUEST_LOCALE_METADATA[locale].nativeName}
          </strong>{' '}
          {first ? 'prints larger' : 'prints smaller, under a short rule'}
        </p>
      )}
      <Field
        id={`${id}-headline`}
        label="Headline"
        value={copy.headline}
        invalid={
          headlineStatus?.tone === 'negative' ||
          normalisePrintFinalText(copy.headline) === ''
        }
        onChange={(text) => words.edit(locale, 'headline', text)}
      >
        <StatusRow
          id={`${id}-headline-status`}
          status={
            normalisePrintFinalText(copy.headline) === ''
              ? {
                  tone: 'negative',
                  text: 'Write a headline, or pick a wording',
                  extra: null,
                }
              : headlineStatus
          }
          counter={headlineCounter}
        />
        {missing !== null && <p className="mt-1 text-xs text-warn">{missing}</p>}
      </Field>
      <Field
        id={`${id}-subline`}
        label="Sub-line"
        value={copy.subline}
        invalid={sublineStatus?.tone === 'negative'}
        onChange={(text) => words.edit(locale, 'subline', text)}
      >
        <StatusRow
          id={`${id}-subline-status`}
          status={sublineStatus}
          counter={printFinalShortCounter(length(copy.subline), guide.subline)}
        />
      </Field>
    </div>
  )
}

export function PrintFinalOwnWords(props: Props) {
  const { words, print } = props
  return (
    <div className="mt-1 flex flex-col gap-5">
      {print.languages.map((locale, index) => (
        <LanguageFields key={locale} {...props} locale={locale} index={index} />
      ))}
      <p className="text-xs text-pretty text-muted-foreground">
        {print.languages.length > 1
          ? 'We print your words exactly as typed and never translate them. Ask someone who speaks the language to check them.'
          : 'Up to 3 lines for the headline and 2 for the sub-line. Check the spelling in the preview: we print your words exactly as typed.'}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcementOf(words)}
      </p>
    </div>
  )
}
