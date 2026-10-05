import { useForm } from '@tanstack/react-form'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import { InheritedSetting } from '#/components/forms/inherited-setting'
import { InlineLink } from '#/components/ui/inline-link'
import { FormNumberField } from '#/components/forms/form-number-field'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { Action } from '#/components/hooks/use-action'
import {
  privateFeedbackPropertyTargetFormDto,
  type SetResponseTargetPolicyDtoInput,
} from '#/contexts/inbox/application/dto/inbox.dto'
import type {
  ResponseTargetPolicySettings,
  ResponseTargetPolicyWriteResult,
} from '#/contexts/inbox/application/public-api'

type UpdatePolicyAction = Action<
  Readonly<{ data: SetResponseTargetPolicyDtoInput }>,
  ResponseTargetPolicyWriteResult
>

export function PrivateFeedbackTargetCard({
  settings,
  updatePolicy,
}: Readonly<{
  settings: ResponseTargetPolicySettings
  updatePolicy: UpdatePolicyAction
}>) {
  const override = settings.privateFeedbackPropertyOverride
  return override ? (
    <PrivateFeedbackTargetFormCard
      // Mounted again on the saved target, so the form starts from it (Reset).
      key={`${override.propertyId}:${override.policyVersion ?? 'default'}`}
      settings={settings}
      override={override}
      updatePolicy={updatePolicy}
    />
  ) : null
}

function PrivateFeedbackTargetFormCard({
  settings,
  override,
  updatePolicy,
}: Readonly<{
  settings: ResponseTargetPolicySettings
  override: NonNullable<ResponseTargetPolicySettings['privateFeedbackPropertyOverride']>
  updatePolicy: UpdatePolicyAction
}>) {
  const organizationHours =
    settings.organization.privateFeedbackHandling.durationMinutes / 60
  const form = useForm({
    defaultValues: {
      useOrganizationTarget: override.durationMinutes === null,
      durationHours: (override.durationMinutes ?? override.effectiveDurationMinutes) / 60,
    },
    validators: { onSubmit: privateFeedbackPropertyTargetFormDto },
    onSubmit: async ({ value }) => {
      await updatePolicy({
        data: {
          scope: 'property',
          propertyId: override.propertyId,
          targetKind: 'private_feedback_handling',
          durationMinutes: value.useOrganizationTarget ? null : value.durationHours * 60,
          expectedPolicyVersion: override.policyVersion,
        },
      })
    },
  })

  return (
    <form onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Private feedback handling target</CardTitle>
          <CardDescription>
            Use the Organization target or save a different target for new handling cycles
            at this Property. Existing cycles keep their original target.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form.Field name="useOrganizationTarget">
            {(field) => (
              <InheritedSetting
                source={
                  <InlineLink to="/settings/organization" underline="always">
                    the Organization target
                  </InlineLink>
                }
                value={`${organizationHours} ${organizationHours === 1 ? 'hour' : 'hours'}`}
                overridden={!field.state.value}
                commit="deferred"
                inheritLabel="Use organization target"
                overrideLabel="Set a property target"
                onInherit={() => field.handleChange(true)}
                onOverride={() => field.handleChange(false)}
                note={
                  field.state.value
                    ? 'This remains linked to future Organization changes.'
                    : undefined
                }
              />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.useOrganizationTarget}>
            {(useOrganizationTarget) => (
              <form.Field name="durationHours">
                {(field) => (
                  <FormNumberField
                    id="property-feedback-target-hours"
                    label="Property hours"
                    min={1}
                    max={720}
                    disabled={useOrganizationTarget}
                    field={field}
                    className="max-w-40"
                  />
                )}
              </form.Field>
            )}
          </form.Subscribe>
        </CardContent>
        <CardFooter>
          <FormActions form={form} error={updatePolicy.error}>
            <SubmitButton mutation={updatePolicy} form={form}>
              Save target
            </SubmitButton>
          </FormActions>
        </CardFooter>
      </Card>
    </form>
  )
}
