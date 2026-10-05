import { useForm } from '@tanstack/react-form'
import type { Action } from '#/components/hooks/use-action'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { blankAsNull, FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Switch } from '#/components/ui/switch'
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
              {(field) => (
                <FormTextField
                  field={field}
                  id="reply-profile-greeting"
                  label="Greeting"
                  maxLength={REPLY_LIBRARY_FIELD_LIMITS.greeting}
                  disabled={disabled}
                  placeholder="Dear {guest_name},"
                />
              )}
            </form.Field>
            <form.Field name="signOffPositive">
              {(field) => (
                <FormTextarea
                  field={field}
                  id="reply-profile-positive-signoff"
                  label="Positive sign-off"
                  maxLength={REPLY_LIBRARY_FIELD_LIMITS.signOff}
                  disabled={disabled}
                  rows={2}
                  placeholder="Warm regards,&#10;The team"
                />
              )}
            </form.Field>
            <form.Field name="signOffNegative">
              {(field) => (
                <FormTextarea
                  field={field}
                  id="reply-profile-negative-signoff"
                  label="Negative sign-off"
                  maxLength={REPLY_LIBRARY_FIELD_LIMITS.signOff}
                  disabled={disabled}
                  rows={2}
                  placeholder="Sincerely,&#10;Guest relations"
                />
              )}
            </form.Field>
            <form.Field name="escalationContact">
              {(field) => (
                <FormTextField
                  field={blankAsNull(field)}
                  id="reply-profile-escalation"
                  label="Escalation contact"
                  optional
                  maxLength={REPLY_LIBRARY_FIELD_LIMITS.escalationContact}
                  disabled={disabled}
                  placeholder="care@example.com"
                />
              )}
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
        </CardContent>
        {canManage ? (
          <CardFooter>
            <FormActions form={form} error={action.error}>
              <SubmitButton mutation={action} form={form}>
                Save reply profile
              </SubmitButton>
            </FormActions>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  )
}
