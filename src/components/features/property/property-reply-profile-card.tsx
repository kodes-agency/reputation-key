import { useForm } from '@tanstack/react-form'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Switch } from '#/components/ui/switch'
import { Textarea } from '#/components/ui/textarea'
import {
  REPLY_LIBRARY_FIELD_LIMITS,
  replyProfileValuesSchema,
  type SavePropertyReplyProfileInput,
} from '#/contexts/review/application/dto/reply-library.dto'
import type { PropertyReplyLibraryProfile } from '#/contexts/review/application/use-cases/reply-library-operations'
import { usePermissions } from '#/shared/hooks/usePermissions'

type SaveReplyProfileAction = Action<{ data: SavePropertyReplyProfileInput }>

type Props = Readonly<{
  propertyId: string
  profile: PropertyReplyLibraryProfile | null
  action: SaveReplyProfileAction
}>

export function PropertyReplyProfileCard({ propertyId, profile, action }: Props) {
  const { can } = usePermissions()
  const canManage = can('reply.manage')
  const form = useForm({
    defaultValues: {
      greeting: profile?.greeting ?? '',
      signOffPositive: profile?.signOffPositive ?? '',
      signOffNegative: profile?.signOffNegative ?? '',
      emojiAllowed: profile?.emojiAllowed ?? false,
      escalationContact: profile?.escalationContact ?? null,
    },
    validators: { onSubmit: replyProfileValuesSchema },
    onSubmit: async ({ value }) => {
      const parsed = replyProfileValuesSchema.parse(value)
      await action({ data: { propertyId, profile: parsed } })
    },
  })
  const disabled = !canManage || action.isPending

  return (
    <form onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader>
          <CardTitle>Reply profile</CardTitle>
          <CardDescription>
            Set the greeting, closing, emoji policy, and escalation contact applied to
            this Property&rsquo;s reply templates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <form.Field name="greeting">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="reply-profile-greeting">Greeting</FieldLabel>
                    <Input
                      id="reply-profile-greeting"
                      className="min-h-11"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      maxLength={REPLY_LIBRARY_FIELD_LIMITS.greeting}
                      disabled={disabled}
                      aria-invalid={invalid}
                      placeholder="Dear {guest_name},"
                    />
                    {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="signOffPositive">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="reply-profile-positive-signoff">
                      Positive sign-off
                    </FieldLabel>
                    <Textarea
                      id="reply-profile-positive-signoff"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      maxLength={REPLY_LIBRARY_FIELD_LIMITS.signOff}
                      disabled={disabled}
                      aria-invalid={invalid}
                      rows={2}
                      placeholder="Warm regards,&#10;The team"
                    />
                    {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="signOffNegative">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="reply-profile-negative-signoff">
                      Negative sign-off
                    </FieldLabel>
                    <Textarea
                      id="reply-profile-negative-signoff"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      maxLength={REPLY_LIBRARY_FIELD_LIMITS.signOff}
                      disabled={disabled}
                      aria-invalid={invalid}
                      rows={2}
                      placeholder="Sincerely,&#10;Guest relations"
                    />
                    {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="escalationContact">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="reply-profile-escalation">
                      Escalation contact
                    </FieldLabel>
                    <Input
                      id="reply-profile-escalation"
                      className="min-h-11"
                      value={field.state.value ?? ''}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(
                          event.target.value === '' ? null : event.target.value,
                        )
                      }
                      maxLength={REPLY_LIBRARY_FIELD_LIMITS.escalationContact}
                      disabled={disabled}
                      aria-invalid={invalid}
                      placeholder="care@example.com"
                    />
                    {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="emojiAllowed">
              {(field) => (
                <Field orientation="horizontal" data-disabled={disabled}>
                  <FieldLabel
                    htmlFor="reply-profile-emoji"
                    className="min-h-11 items-center"
                  >
                    Allow emoji in rendered templates
                  </FieldLabel>
                  <Switch
                    id="reply-profile-emoji"
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                    disabled={disabled}
                    aria-label="Allow emoji in rendered templates"
                  />
                </Field>
              )}
            </form.Field>
          </FieldGroup>
          {!canManage ? (
            <p className="text-sm text-muted-foreground">
              Ask a property manager or account admin to manage this reply profile.
            </p>
          ) : null}
          <FormErrorBanner error={action.error} />
        </CardContent>
        {canManage ? (
          <CardFooter className="justify-end">
            <SubmitButton mutation={action} form={form} className="min-h-11">
              Save reply profile
            </SubmitButton>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  )
}
