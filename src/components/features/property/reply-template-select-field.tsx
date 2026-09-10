import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  replyTemplateAspectSchema,
  type ReplyTemplateValues,
} from '#/contexts/review/application/dto/reply-library.dto'
import { ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'

type SelectOption = Readonly<{ value: string; label: string }>
type FieldErrors = Array<{ message?: string } | undefined>

export type ReplyTemplateSelectFieldApi<T> = Readonly<{
  state: Readonly<{
    value: T
    meta: Readonly<{
      isTouched: boolean
      isValid: boolean
      errors: FieldErrors
    }>
  }>
  handleChange: (value: T) => void
  handleBlur: () => void
}>

const RATING_OPTIONS: readonly SelectOption[] = [1, 2, 3, 4, 5].map((rating) => ({
  value: String(rating),
  label: `${rating} star${rating === 1 ? '' : 's'}`,
}))

const ASPECT_OPTIONS: readonly SelectOption[] = [
  { value: 'general', label: 'General' },
  ...ASPECT_TAXONOMY_V1.map((aspect) => ({
    value: aspect,
    label: aspect.replaceAll('_', ' '),
  })),
]

const REVIEW_TYPE_OPTIONS: readonly SelectOption[] = [
  { value: 'with-text', label: 'Review with text' },
  { value: 'rating-only', label: 'Rating only' },
]

type SelectProps = Readonly<{
  id: string
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  onBlur: () => void
  disabled: boolean
  invalid: boolean
  errors: FieldErrors
}>

function ReplyTemplateSelectField({
  id,
  label,
  value,
  options,
  onChange,
  onBlur,
  disabled,
  invalid,
  errors,
}: SelectProps) {
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="min-h-11 w-full capitalize"
          onBlur={onBlur}
          aria-invalid={invalid}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="min-h-11 capitalize"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {invalid ? <FieldError errors={errors} /> : null}
    </Field>
  )
}

function fieldState<T>(field: ReplyTemplateSelectFieldApi<T>) {
  return {
    onBlur: field.handleBlur,
    invalid: field.state.meta.isTouched && !field.state.meta.isValid,
    errors: field.state.meta.errors,
  }
}

type AdaptedSelectProps<T> = Readonly<{
  field: ReplyTemplateSelectFieldApi<T>
  disabled: boolean
}>

export function ReplyTemplateRatingSelect({
  id,
  label,
  field,
  disabled,
}: AdaptedSelectProps<number> & Readonly<{ id: string; label: string }>) {
  return (
    <ReplyTemplateSelectField
      id={id}
      label={label}
      value={String(field.state.value)}
      options={RATING_OPTIONS}
      onChange={(value) => field.handleChange(Number(value))}
      disabled={disabled}
      {...fieldState(field)}
    />
  )
}

export function ReplyTemplateReviewTypeSelect({
  field,
  disabled,
}: AdaptedSelectProps<boolean>) {
  return (
    <ReplyTemplateSelectField
      id="reply-template-review-type"
      label="Review type"
      value={field.state.value ? 'with-text' : 'rating-only'}
      options={REVIEW_TYPE_OPTIONS}
      onChange={(value) => field.handleChange(value === 'with-text')}
      disabled={disabled}
      {...fieldState(field)}
    />
  )
}

export function ReplyTemplateAspectSelect({
  field,
  disabled,
}: AdaptedSelectProps<ReplyTemplateValues['aspect']>) {
  return (
    <ReplyTemplateSelectField
      id="reply-template-aspect"
      label="Aspect"
      value={field.state.value ?? 'general'}
      options={ASPECT_OPTIONS}
      onChange={(value) =>
        field.handleChange(
          value === 'general' ? null : replyTemplateAspectSchema.parse(value),
        )
      }
      disabled={disabled}
      {...fieldState(field)}
    />
  )
}
