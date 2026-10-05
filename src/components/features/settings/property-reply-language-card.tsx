import { useForm } from '@tanstack/react-form'
import { StatusBadge } from '#/components/ui/status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { FieldGroup } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { FormActions } from '#/components/forms/form-actions'
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import type { Action } from '#/components/hooks/use-action'
import { updatePropertyInputSchema } from '#/contexts/property/application/dto/update-property.dto'
import { PROPERTY_REPLY_LANGUAGE_OPTIONS } from './property-reply-language-options'

const UNCONFIGURED = '__not_configured__'
const DEFAULT_LANGUAGE_HELP =
  'This choice is explicit and is never inferred from the property country or timezone.'
const replyLanguageFormSchema = updatePropertyInputSchema
  .pick({ defaultReplyLanguage: true })
  .required()

type UpdateInput = Readonly<{
  data: Readonly<{
    propertyId: string
    defaultReplyLanguage: string | null
  }>
}>

export type PropertyReplyLanguageUpdateAction = Action<UpdateInput, unknown>

type Props = Readonly<{
  property: Readonly<{
    id: string
    name: string
    defaultReplyLanguage?: string | null
  }>
  updateProperty: PropertyReplyLanguageUpdateAction
}>

export function PropertyReplyLanguageCard({ property, updateProperty }: Props) {
  const configuredLanguage = property.defaultReplyLanguage ?? null
  const form = useForm({
    defaultValues: { defaultReplyLanguage: configuredLanguage },
    validators: { onSubmit: replyLanguageFormSchema },
    onSubmit: async ({ value }) => {
      await updateProperty({
        data: {
          propertyId: property.id,
          defaultReplyLanguage: value.defaultReplyLanguage,
        },
      })
    },
  })

  return (
    <form onSubmit={submitHandler(form)}>
      <Card className="min-w-0">
        <CardHeader className="border-b">
          <CardTitle as="h2">Reply language</CardTitle>
          <CardDescription>
            Default for public replies and AI drafts at {property.name}. Each review can
            still use the guest&apos;s language instead.
          </CardDescription>
          <CardAction>
            <StatusBadge
              tone={configuredLanguage ? 'positive' : 'neutral'}
              label={configuredLanguage ? 'Configured' : 'Not configured'}
            />
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <form.Field name="defaultReplyLanguage">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <FormFieldFrame
                    id="property-reply-language"
                    label="Property default"
                    description={DEFAULT_LANGUAGE_HELP}
                    invalid={invalid}
                    errors={invalid ? field.state.meta.errors : undefined}
                  >
                    <Select
                      value={field.state.value ?? UNCONFIGURED}
                      disabled={updateProperty.isPending}
                      onValueChange={(value) =>
                        field.handleChange(value === UNCONFIGURED ? null : value)
                      }
                    >
                      <SelectTrigger
                        id="property-reply-language"
                        className="w-full max-w-md"
                        aria-invalid={invalid}
                        aria-describedby={describedByOf(
                          'property-reply-language',
                          DEFAULT_LANGUAGE_HELP,
                        )}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={UNCONFIGURED}>Not configured</SelectItem>
                          {PROPERTY_REPLY_LANGUAGE_OPTIONS.map((option) => (
                            <SelectItem key={option.tag} value={option.tag}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormFieldFrame>
                )
              }}
            </form.Field>
          </FieldGroup>
        </CardContent>

        <CardFooter className="border-t">
          <FormActions form={form} error={updateProperty.error}>
            <SubmitButton mutation={updateProperty} form={form}>
              Save reply language
            </SubmitButton>
          </FormActions>
        </CardFooter>
      </Card>
    </form>
  )
}
