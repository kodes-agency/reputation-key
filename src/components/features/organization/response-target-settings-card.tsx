import { useForm } from '@tanstack/react-form'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitForm } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormNumberField } from '#/components/forms/form-number-field'
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

/**
 * Google reviews only. A low-rated review is the work that goes wrong fastest,
 * so an Organization may give it a shorter target and therefore an earlier
 * halfway and target-time reminder. Off leaves one clock for every review,
 * which is what every Organization had before this control existed.
 */
function LowRatingTargetFields({
  form,
}: Readonly<{ form: ReturnType<typeof useLowRatingForm> }>) {
  return (
    <div className="sm:col-span-3">
      <form.Field name="shortenForLowRatings">
        {(field) => (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={field.state.value === true}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
            Answer low-rated reviews sooner
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.shortenForLowRatings === true}>
        {(enabled) =>
          enabled ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-[9rem_9rem] sm:items-end">
              <form.Field name="lowRatingThreshold">
                {(field) => (
                  <FormNumberField
                    id="low-rating-threshold"
                    label="At or below (stars)"
                    min={1}
                    max={5}
                    field={field}
                  />
                )}
              </form.Field>
              <form.Field name="lowRatingHours">
                {(field) => (
                  <FormNumberField
                    id="low-rating-hours"
                    label="Within (hours)"
                    min={1}
                    max={720}
                    field={field}
                  />
                )}
              </form.Field>
            </div>
          ) : null
        }
      </form.Subscribe>
    </div>
  )
}

/** The form shape both target cards share; only Google fills the last three. */
const useLowRatingForm = (
  policy: OrganizationPolicy,
  updatePolicy: UpdatePolicyAction,
  offersLowRating: boolean,
) =>
  useForm({
    defaultValues: {
      durationHours: policy.durationMinutes / 60,
      shortenForLowRatings: policy.lowRating !== null,
      lowRatingThreshold: policy.lowRating?.threshold ?? 2,
      lowRatingHours: (policy.lowRating?.durationMinutes ?? 240) / 60,
    },
    validators: { onSubmit: organizationResponseTargetFormDto },
    onSubmit: async ({ value }) => {
      await updatePolicy({
        data: {
          scope: 'organization',
          targetKind: policy.targetKind,
          durationMinutes: value.durationHours * 60,
          expectedPolicyVersion: policy.policyVersion,
          // Only the Google card may say anything about low ratings; the
          // private-feedback card leaves the stored value untouched.
          ...(offersLowRating
            ? {
                lowRating: value.shortenForLowRatings
                  ? {
                      threshold: value.lowRatingThreshold,
                      durationMinutes: value.lowRatingHours * 60,
                    }
                  : null,
              }
            : {}),
        },
      })
    },
  })

function TargetPolicyForm({
  label,
  description,
  policy,
  updatePolicy,
  offersLowRating = false,
}: Readonly<{
  label: string
  description: string
  policy: OrganizationPolicy
  updatePolicy: UpdatePolicyAction
  offersLowRating?: boolean
}>) {
  const form = useLowRatingForm(policy, updatePolicy, offersLowRating)

  return (
    <form
      className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void submitForm(form)
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
          <FormNumberField
            id={`${policy.targetKind}-hours`}
            label="Hours"
            min={1}
            max={720}
            field={field}
          />
        )}
      </form.Field>
      <SubmitButton mutation={updatePolicy} form={form}>
        Save target
      </SubmitButton>
      {offersLowRating ? <LowRatingTargetFields form={form} /> : null}
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
          offersLowRating
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
