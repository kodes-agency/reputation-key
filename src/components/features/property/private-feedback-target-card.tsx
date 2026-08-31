import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
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
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Private feedback handling target</CardTitle>
          <CardDescription>
            Use the Organization target or save a different target for new handling cycles
            at this Property. Existing cycles keep their original target.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormErrorBanner error={updatePolicy.error} />
          <form.Field name="useOrganizationTarget">
            {(field) => (
              <div className="flex items-start gap-3">
                <Checkbox
                  id="use-organization-feedback-target"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                  onBlur={field.handleBlur}
                />
                <div className="grid gap-1">
                  <Label htmlFor="use-organization-feedback-target">
                    Use Organization target ({organizationHours} hours)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    This remains linked to future Organization changes.
                  </p>
                </div>
              </div>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.useOrganizationTarget}>
            {(useOrganizationTarget) => (
              <form.Field name="durationHours">
                {(field) => (
                  <div className="grid max-w-40 gap-1.5">
                    <Label htmlFor="property-feedback-target-hours">Property hours</Label>
                    <Input
                      id="property-feedback-target-hours"
                      type="number"
                      min={1}
                      max={720}
                      disabled={useOrganizationTarget}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.valueAsNumber)}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                  </div>
                )}
              </form.Field>
            )}
          </form.Subscribe>
          <SubmitButton mutation={updatePolicy} form={form}>
            Save Property target
          </SubmitButton>
        </CardContent>
      </Card>
    </form>
  )
}
