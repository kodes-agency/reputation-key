import { Globe2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  AUTO_DETECT_REVIEW_LANGUAGE,
  languageDisplayName,
  type ReplyLanguageOption,
} from './reply-language-options'

type Props = Readonly<{
  value: string | null
  options: ReadonlyArray<ReplyLanguageOption>
  disabled: boolean
  onChange: (tag: string) => void
}>

const sourceLabels: Record<ReplyLanguageOption['source'], string> = {
  property: 'Property default',
  review: 'Review language',
  review_auto: 'Detect automatically',
  saved: 'Saved draft',
}

export function ReplyLanguageSelect({ value, options, disabled, onChange }: Props) {
  const selectedOption = options.find((option) => option.tag === value)
  const languageName =
    value === AUTO_DETECT_REVIEW_LANGUAGE
      ? 'Review language'
      : (languageDisplayName(value) ?? 'Language not set')
  const sourceLabel = selectedOption ? sourceLabels[selectedOption.source] : null

  return (
    <div data-slot="reply-language" className="min-w-0">
      <Select
        value={value ?? ''}
        disabled={disabled || options.length === 0}
        onValueChange={onChange}
      >
        <SelectTrigger
          aria-label="Reply language"
          className="h-10 w-full min-w-0 gap-2.5 rounded-lg border-border/80 bg-background px-3 shadow-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/25 data-[size=default]:h-10 @min-[38rem]/reply-workspace:w-[17.5rem] [&>svg:last-child]:ml-auto"
        >
          <Globe2 className="size-[18px] text-muted-foreground" />
          <SelectValue placeholder="Language not set">
            <span className="min-w-0 truncate font-medium text-foreground">
              {languageName}
            </span>
            {sourceLabel && (
              <>
                <span aria-hidden="true" className="text-muted-foreground/70">
                  ·
                </span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {sourceLabel}
                </span>
              </>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={`${option.source}-${option.tag}`} value={option.tag}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
