// "Write your own…" in the Print cards section (design spec §5.6,
// §5.7 and §8; the boards share-words-custom, share-words-two-languages,
// share-words-states and share-words-phone): a Headline and a Sub-line for each
// language on the print, prefilled from the wording, each with the planner's
// status and a counter that is a guide, never a limit. A second language's pair
// appears only with two languages and is never translated. Every status is an
// icon and words, tied to its field, and read out only when it changes.

import { Ban, CircleCheck, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useIsBelowLarge } from '#/components/hooks/use-mobile'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import {
  PRINT_CUSTOM_MAX_CHARACTERS,
  normalisePrintText,
} from '#/shared/domain/portal-print-custom'
import { unsupportedCharacters } from '#/shared/domain/portal-print-kit-font-ranges'
import { PRINT_TYPE } from '#/shared/domain/portal-print-type'
import {
  PRINT_WORDS_GUIDE,
  printHeadlineCounter,
  printHeadlineStatus,
  printSecondStatus,
  printShortCounter,
  printSublineStatus,
  type PrintFieldStatus,
} from '#/shared/domain/portal-print-words-copy'
import type { PrintSharePrint } from './print-state'
import { PrintWordsNote } from './print-words-note'
import type { PrintWordsState } from './use-print-words'

type Props = Readonly<{ words: PrintWordsState; print: PrintSharePrint }>

const TONE_CLASS: Readonly<Record<PrintFieldStatus['tone'], string>> = {
  positive: 'text-positive',
  neutral: 'text-muted-foreground',
  negative: 'text-negative',
}

const TONE_ICON = { positive: CircleCheck, neutral: Info, negative: Ban } as const

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
}: Readonly<{ id: string; status: PrintFieldStatus | null; counter: string }>) {
  const Icon = status === null ? null : TONE_ICON[status.tone]
  return (
    <div id={id} className="mt-1.5 flex items-start justify-between gap-x-4 text-xs">
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
        maxLength={PRINT_CUSTOM_MAX_CHARACTERS}
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

const length = (text: string) => [...normalisePrintText(text)].length

/** The announcement for the first headline: it changes only with the state, not with each keystroke. */
function announcementOf(words: PrintWordsState): string {
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
  const guide = PRINT_WORDS_GUIDE[print.piece][print.orientation]
  const two = print.languages.length > 1
  const id = `print-final-own-${locale}`
  const first = index === 0
  const headlineStatus =
    own === null
      ? null
      : first
        ? printHeadlineStatus(
            print,
            own.fit,
            own.shortenBy,
            length(copy.headline),
            print.languages.length,
          )
        : printSecondStatus(
            own.fit,
            print.languages[0] ?? 'en',
            PRINT_TYPE[print.piece].secondHeadlinePt,
          )
  const sublineLines = first ? own?.fit.sublineLines : own?.fit.secondSublineLines
  const sublineStatus: PrintFieldStatus | null =
    own === null
      ? null
      : !first && own.fit.secondMode === 'line'
        ? { tone: 'neutral', text: 'Upright pieces print the headline only', extra: null }
        : printSublineStatus(length(copy.subline), {
            ...own.fit,
            sublineLines: sublineLines ?? 0,
          })
  const missing = missingCharactersNote(`${copy.headline} ${copy.subline}`)
  const headlineCounter = first
    ? printHeadlineCounter(print, length(copy.headline), print.languages.length, compact)
    : printShortCounter(length(copy.headline), guide.secondHeadline)
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
          headlineStatus?.tone === 'negative' || normalisePrintText(copy.headline) === ''
        }
        onChange={(text) => words.edit(locale, 'headline', text)}
      >
        <StatusRow
          id={`${id}-headline-status`}
          status={
            normalisePrintText(copy.headline) === ''
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
        <PrintWordsNote words={words} print={print} locale={locale} />
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
          counter={printShortCounter(length(copy.subline), guide.subline)}
        />
      </Field>
    </div>
  )
}

export function PrintOwnWords(props: Props) {
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
