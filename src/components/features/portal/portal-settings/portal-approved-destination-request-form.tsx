import { useForm } from '@tanstack/react-form'
import { SubmitButton } from '#/components/forms/submit-button'
import { FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { portalApprovedDestinationRequestInputSchema } from '#/contexts/portal/application/dto/portal-experience.dto'
import type { PortalExperienceActions } from './portal-experience-settings-types'

const destinationRequestFormSchema = portalApprovedDestinationRequestInputSchema
  .pick({ uri: true })
  .required()

export function PortalApprovedDestinationRequestForm({
  portalId,
  action,
  disabled,
}: Readonly<{
  portalId: string
  action: PortalExperienceActions['requestDestination']
  disabled: boolean
}>) {
  const form = useForm({
    defaultValues: { uri: '' },
    validators: { onSubmit: destinationRequestFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = destinationRequestFormSchema.parse(value)
      await action({ data: { portalId, uri: parsed.uri } })
      form.reset()
    },
  })
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit().catch(() => undefined)
      }}
    >
      <form.Field name="uri">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <div className="min-w-0 flex-1">
              <Label className="sr-only" htmlFor="portal-approved-destination-uri">
                HTTPS destination
              </Label>
              <Input
                id="portal-approved-destination-uri"
                name={field.name}
                type="url"
                placeholder="https://example.com/your-page"
                maxLength={2_048}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                aria-invalid={invalid}
                disabled={disabled || action.isPending}
              />
              {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
            </div>
          )
        }}
      </form.Field>
      <SubmitButton mutation={action} form={form} variant="outline" disabled={disabled}>
        {action.isPending ? 'Checking…' : 'Add destination'}
      </SubmitButton>
    </form>
  )
}
