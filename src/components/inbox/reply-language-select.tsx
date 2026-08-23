import { Languages } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { languageDisplayName, type ReplyLanguageOption } from './reply-language-options'

type Props = Readonly<{
  value: string | null
  options: ReadonlyArray<ReplyLanguageOption>
  propertyLanguageTag: string | null
  disabled: boolean
  onChange: (tag: string) => void
}>

export function ReplyLanguageSelect({
  value,
  options,
  propertyLanguageTag,
  disabled,
  onChange,
}: Props) {
  return (
    <div
      data-slot="reply-language"
      className="flex min-w-0 flex-wrap items-center justify-between gap-2"
    >
      <div>
        <p className="text-sm font-medium">Reply language</p>
        <p className="text-xs text-muted-foreground">
          {propertyLanguageTag
            ? `Property default: ${languageDisplayName(propertyLanguageTag)}.`
            : 'Property default is not configured.'}
        </p>
      </div>
      <Select
        value={value ?? undefined}
        disabled={disabled || options.length === 0}
        onValueChange={onChange}
      >
        <SelectTrigger size="sm" aria-label="Reply language" className="max-w-full">
          <Languages className="text-muted-foreground" />
          <SelectValue placeholder="Language not set" />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((option) => (
            <SelectItem key={`${option.source}-${option.tag}`} value={option.tag}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
