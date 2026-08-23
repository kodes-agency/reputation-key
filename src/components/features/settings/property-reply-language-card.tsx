import { useForm } from '@tanstack/react-form'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import type { Action } from '#/components/hooks/use-action'
import { updatePropertyInputSchema } from '#/contexts/property/application/dto/update-property.dto'
import { PROPERTY_REPLY_LANGUAGE_OPTIONS } from './property-reply-language-options'

const UNCONFIGURED = '__not_configured__'
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
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <Card className="min-w-0">
        <CardHeader className="border-b">
          <CardTitle>Reply language</CardTitle>
          <CardDescription>
            Default for public replies and AI drafts at {property.name}. Each review can
            still use the guest&apos;s language instead.
          </CardDescription>
          <CardAction>
            <Badge variant={configuredLanguage ? 'secondary' : 'outline'}>
              {configuredLanguage ? 'Configured' : 'Not configured'}
            </Badge>
          </CardAction>
        </CardHeader>

        <CardContent>
          <FormErrorBanner error={updateProperty.error} />
          <FieldGroup>
            <form.Field name="defaultReplyLanguage">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="property-reply-language">
                      Property default
                    </FieldLabel>
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
                        aria-describedby="property-reply-language-help"
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
                    <p
                      id="property-reply-language-help"
                      className="text-sm text-muted-foreground"
                    >
                      This choice is explicit and is never inferred from the property
                      country or timezone.
                    </p>
                    {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                  </Field>
                )
              }}
            </form.Field>
          </FieldGroup>
        </CardContent>

        <CardFooter className="justify-end border-t">
          <SubmitButton mutation={updateProperty} form={form}>
            Save reply language
          </SubmitButton>
        </CardFooter>
      </Card>
    </form>
  )
}
