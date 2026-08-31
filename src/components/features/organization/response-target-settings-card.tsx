import { useForm } from '@tanstack/react-form'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import {
  organizationResponseTargetFormDto,
  type SetResponseTargetPolicyDtoInput,
} from '#/contexts/inbox/application/dto/inbox.dto'
import type {
  GoogleReviewTargetAnalytics,
  PrivateFeedbackTargetAnalytics,
  ResponseTargetPolicySettings,
  ResponseTargetPolicyWriteResult,
} from '#/contexts/inbox/application/public-api'
import {
  GoogleReviewTargetSummary,
  PrivateFeedbackTargetSummary,
} from './response-target-analytics-summary'

type UpdatePolicyAction = Action<
  Readonly<{ data: SetResponseTargetPolicyDtoInput }>,
  ResponseTargetPolicyWriteResult
>

type OrganizationPolicy =
  ResponseTargetPolicySettings['organization']['googleReviewResponse']

function TargetPolicyForm({
  label,
  description,
  policy,
  updatePolicy,
}: Readonly<{
  label: string
  description: string
  policy: OrganizationPolicy
  updatePolicy: UpdatePolicyAction
}>) {
  const form = useForm({
    defaultValues: { durationHours: policy.durationMinutes / 60 },
    validators: { onSubmit: organizationResponseTargetFormDto },
    onSubmit: async ({ value }) => {
      await updatePolicy({
        data: {
          scope: 'organization',
          targetKind: policy.targetKind,
          durationMinutes: value.durationHours * 60,
          expectedPolicyVersion: policy.policyVersion,
        },
      })
    },
  })

  return (
    <form
      className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{label}</p>
          {policy.policySource === 'builtin_default' ? (
            <Badge variant="outline">Default</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <form.Field name="durationHours">
        {(field) => (
          <div className="grid gap-1.5">
            <Label htmlFor={`${policy.targetKind}-hours`}>Hours</Label>
            <Input
              id={`${policy.targetKind}-hours`}
              type="number"
              min={1}
              max={720}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.valueAsNumber)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
          </div>
        )}
      </form.Field>
      <SubmitButton mutation={updatePolicy} form={form}>
        Save target
      </SubmitButton>
    </form>
  )
}

export function ResponseTargetSettingsCard({
  settings,
  privateFeedbackAnalytics,
  googleReviewAnalytics,
  updatePolicy,
}: Readonly<{
  settings: ResponseTargetPolicySettings
  privateFeedbackAnalytics: PrivateFeedbackTargetAnalytics
  googleReviewAnalytics: GoogleReviewTargetAnalytics
  updatePolicy: UpdatePolicyAction
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Response targets</CardTitle>
        <CardDescription>
          Working targets help managers prioritize follow-up. They measure timing but do
          not close or escalate an Inbox item automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FormErrorBanner error={updatePolicy.error} />
        <TargetPolicyForm
          key={`google:${settings.organization.googleReviewResponse.policyVersion ?? 'default'}`}
          label="Google review response"
          description="Measured from the saved Google publication, meaningful review update, or reopen time; onboarding history is excluded."
          policy={settings.organization.googleReviewResponse}
          updatePolicy={updatePolicy}
        />
        <div className="space-y-3 border-t pt-5">
          <div>
            <h3 className="font-medium">Google review response performance</h3>
            <p className="text-sm text-muted-foreground">
              Based only on cycles with reliable saved timing. Imported history and older
              records without timing evidence stay visible as excluded counts.
            </p>
          </div>
          <GoogleReviewTargetSummary analytics={googleReviewAnalytics} />
        </div>
        <TargetPolicyForm
          key={`feedback:${settings.organization.privateFeedbackHandling.policyVersion ?? 'default'}`}
          label="Private feedback handling"
          description="Applies to new feedback handling cycles unless a Property override is enabled."
          policy={settings.organization.privateFeedbackHandling}
          updatePolicy={updatePolicy}
        />
        <div className="space-y-3 border-t pt-5">
          <div>
            <h3 className="font-medium">Private feedback performance</h3>
            <p className="text-sm text-muted-foreground">
              Only cycles with a reliable saved target are included.
            </p>
          </div>
          <PrivateFeedbackTargetSummary analytics={privateFeedbackAnalytics} />
        </div>
      </CardContent>
    </Card>
  )
}
