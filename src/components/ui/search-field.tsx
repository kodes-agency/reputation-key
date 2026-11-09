import { useRef, useState, type KeyboardEventHandler } from 'react'
import { Search, X } from 'lucide-react'

import { MAX_LIST_SEARCH_LENGTH } from '#/components/property/list-search-limit'
import { IconButton } from '#/components/ui/icon-button'
import { Input } from '#/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#/components/ui/input-group'
import { cn } from '#/lib/utils'

/** The browser draws its own cancel glyph in a search input; the field draws one, so never two. */
const NO_NATIVE_CANCEL = '[&::-webkit-search-cancel-button]:appearance-none'

type Props = Readonly<{
  /** What the field searches, as its accessible name: "Search properties". */
  label: string
  value: string
  onValueChange: (value: string) => void
  /** An example worth more than the name ("Search name or address"); defaults to the label. */
  placeholder?: string
  /** The longest search the list's URL keeps. Defaults to the one every list shares. */
  maxLength?: number
  /** `field` is the bordered input of a toolbar; `bare` is a glyph and an input for a bar that is the frame. */
  variant?: 'field' | 'bare'
  /** The field's own clear button, drawn once there is text. A `bare` field never draws one: its bar closes it. */
  clearable?: boolean
  clearLabel?: string
  autoFocus?: boolean
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  className?: string
}>

/**
 * The one search input of a list: `type="search"`, the InputGroup recipe with a Search
 * glyph, the shared length limit (URL schemas drop a longer search), and a clear
 * button that refocuses the field and is a tap target on a phone though the glyph is
 * 12px. It owns no matching: lists match with `searchMatcher`
 * (`#/components/property/property-search`). The Inbox composes the `bare` variant.
 *
 * Lists keep the search in the URL and a keystroke is a navigation, committed only
 * once the route has loaded. The field keeps what was typed as a draft and shows it
 * until `value` catches up; a change to `value` the person did not type (Clear all,
 * Back) replaces the draft.
 */
export function SearchField({
  label,
  value,
  onValueChange,
  placeholder = label,
  maxLength = MAX_LIST_SEARCH_LENGTH,
  variant = 'field',
  clearable = true,
  clearLabel = 'Clear search',
  autoFocus,
  onKeyDown,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<SearchDraft | null>(null)
  // Settled during render, as React advises for state derived from a prop: the
  // frame in which `value` moved already shows the right text.
  const draft = reconcileDraft(pending, value)
  if (draft !== pending) setPending(draft)
  const shown = shownText(draft, value)
  const change = (text: string) => {
    setPending(typeIntoDraft(draft, value, text))
    onValueChange(text)
  }
  const input = {
    type: 'search',
    'aria-label': label,
    placeholder,
    maxLength,
    value: shown,
    autoFocus,
    onKeyDown,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(event.target.value),
    // A person who leaves the field sees the search the page is on.
    onBlur: () => setPending(null),
  } as const

  if (variant === 'bare') {
    return (
      <div
        data-slot="search-field"
        data-variant="bare"
        className={cn('flex min-w-0 flex-1 items-center gap-2', className)}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          {...input}
          className={cn(
            'h-8 min-w-0 flex-1 border-0 px-0 shadow-none focus-visible:ring-0',
            NO_NATIVE_CANCEL,
          )}
        />
      </div>
    )
  }

  return (
    <InputGroup data-variant="field" className={cn('w-full sm:w-72', className)}>
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput ref={inputRef} {...input} className={NO_NATIVE_CANCEL} />
      {clearable && shown !== '' ? (
        // The X is a tap target below `md` (`touch`), so the addon adds no padding of
        // its own around it: the field is as tall as the button, not 12px taller.
        <InputGroupAddon align="inline-end" className="py-0">
          <IconButton
            size="icon-xs"
            touch
            label={clearLabel}
            tooltip={false}
            onClick={() => {
              change('')
              // The button leaves with the text: keep the focus in the field.
              inputRef.current?.focus()
            }}
          >
            <X />
          </IconButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

// Draft state: a slow navigation must not put the field back to older text or drop
// keys typed meanwhile, so the field shows the draft until the committed value
// has caught up.

export type SearchDraft = Readonly<{
  /** What the field shows: the last thing typed. */
  text: string
  /** Everything typed that the committed value has not reached yet, oldest first. */
  typed: readonly string[]
  /** The committed value when it was last looked at, to tell a change from no change. */
  seen: string
}>

/** A keystroke: the new text is the draft, and is now owed an echo from the page. */
export function typeIntoDraft(
  draft: SearchDraft | null,
  committed: string,
  text: string,
): SearchDraft {
  return {
    text,
    typed: [...(draft?.typed ?? []), text],
    seen: draft?.seen ?? committed,
  }
}

/**
 * The draft after the committed value moved (or did not).
 *
 * - The same value: nothing to do, the same draft comes back (so a caller can
 *   tell by identity that nothing changed).
 * - The value reached the draft: the page has caught up, the draft is done.
 * - A value the person typed, but an older one: a stale echo of an earlier
 *   keystroke. The newer text stays; only the echoes already seen are forgotten.
 * - A value the person never typed (Clear all, Back, a link): the page changed
 *   the search under the field, so the field shows it.
 */
export function reconcileDraft(
  draft: SearchDraft | null,
  committed: string,
): SearchDraft | null {
  if (draft === null || committed === draft.seen) return draft
  if (committed === draft.text) return null
  const index = draft.typed.indexOf(committed)
  if (index === -1) return null
  return { ...draft, typed: draft.typed.slice(index + 1), seen: committed }
}

/** What the field shows. */
export function shownText(draft: SearchDraft | null, committed: string): string {
  return draft === null ? committed : draft.text
}
