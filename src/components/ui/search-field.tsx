import { useRef, type KeyboardEventHandler } from 'react'
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
 * The one search input of a list (UI consistency scan: COLL-13): `type="search"`,
 * the InputGroup recipe with a Search glyph, the shared length limit (the URL
 * schemas drop a longer search, so the box stops typing there rather than
 * clearing itself on the 101st character), and a clear button that gives the
 * focus back to the field. It owns no matching: a list matches with
 * `searchMatcher` (`#/components/property/property-search`), which folds case and
 * accents the same way everywhere.
 *
 * Five recipes existed: this one on Properties and Portals, the Inbox's
 * borderless input in a header, Google import's hand-placed icon, and cmdk's own
 * field in a picker (which is a different job and keeps the Command primitive's).
 * The Inbox composes the `bare` variant, so its glyph, input type and limit are
 * these.
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
  const input = {
    type: 'search',
    'aria-label': label,
    placeholder,
    maxLength,
    value,
    autoFocus,
    onKeyDown,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      onValueChange(event.target.value),
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
      {clearable && value !== '' ? (
        <InputGroupAddon align="inline-end">
          <IconButton
            size="icon-xs"
            label={clearLabel}
            tooltip={false}
            onClick={() => {
              onValueChange('')
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
