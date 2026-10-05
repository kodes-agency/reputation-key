import { SectionTitle } from '#/components/ui/section-title'
import type {
  CurrentMerchantAiCapability,
  MerchantAiState,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { CardContent } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { ConsentCheckbox } from '#/components/forms/consent-checkbox'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { MerchantAiDataHandling } from './merchant-ai-data-handling'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { InlineLink } from '#/components/ui/inline-link'

export type MerchantAiPropertyOption = Readonly<{
  id: string
  name: string
  defaultReplyLanguage?: string | null
  googleBindingState:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
}>

function MerchantAiGoogleSourceUnavailable() {
  const { can } = usePermissions()
  const canManageGoogleConnection = can('integration.manage')
  const canConfirmGoogleProperty = can('property.import_gbp_v2')

  return (
    <Alert variant="warning">
      <AlertTitle>Google source unavailable</AlertTitle>
      <AlertDescription>
        <p>
          Connect and confirm this property&apos;s Google Business Profile before enabling
          AI features. Existing authorization can still be turned off.
        </p>
        {canManageGoogleConnection || canConfirmGoogleProperty ? (
          <div className="flex flex-wrap items-center gap-1">
            {canManageGoogleConnection ? (
              <InlineLink to="/settings/integrations" className="text-xs">
                Open Google integrations
              </InlineLink>
            ) : null}
            {canConfirmGoogleProperty ? (
              <InlineLink to="/properties/import-google" className="text-xs">
                Review property import
              </InlineLink>
            ) : null}
          </div>
        ) : null}
        {!canManageGoogleConnection || !canConfirmGoogleProperty ? (
          <p>
            Ask an account admin to connect Google and confirm this property&apos;s
            Business Profile.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

export function MerchantAiSettingsContent({
  propertyName,
  sourceActive,
  state,
  notice,
  selectedCapabilities,
  acknowledged,
  pending,
  errorMessage,
  onToggleCapability,
  onAcknowledgedChange,
}: Readonly<{
  propertyName: string
  sourceActive: boolean
  state: MerchantAiState
  notice: MerchantAiNoticeDto
  selectedCapabilities: ReadonlyArray<CurrentMerchantAiCapability>
  acknowledged: boolean
  pending: boolean
  errorMessage: string | null
  onToggleCapability: (capability: CurrentMerchantAiCapability, checked: boolean) => void
  onAcknowledgedChange: (acknowledged: boolean) => void
}>) {
  const isEnabled = state === 'enabled'
  const showsInitialEnablement = state === 'disabled' || state === 'revoked'
  const { payload } = notice

  return (
    <CardContent className="flex min-w-0 flex-col gap-6">
      {!sourceActive ? <MerchantAiGoogleSourceUnavailable /> : null}

      <MerchantAiDataHandling notice={notice} />

      <FieldGroup data-slot="checkbox-group">
        <div>
          <SectionTitle>AI features</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Initial enablement turns on all three features. Afterward, each feature can be
            changed independently.
          </p>
        </div>
        {payload.capabilities.map((capability) => {
          const checked = showsInitialEnablement
            ? true
            : selectedCapabilities.includes(capability.id)
          return (
            <Field
              key={capability.id}
              orientation="horizontal"
              data-disabled={!isEnabled}
            >
              <Checkbox
                id={`merchant-ai-${capability.id}`}
                checked={checked}
                disabled={!isEnabled || pending}
                onCheckedChange={(next) =>
                  onToggleCapability(capability.id, next === true)
                }
              />
              <FieldLabel htmlFor={`merchant-ai-${capability.id}`}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span>{capability.title}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {capability.description}
                  </span>
                </span>
              </FieldLabel>
            </Field>
          )
        })}
      </FieldGroup>

      <ConsentCheckbox
        id="merchant-ai-acknowledgement"
        checked={acknowledged}
        disabled={pending}
        onCheckedChange={onAcknowledgedChange}
        description="Required to enable or change AI features. RepKey records who agreed and the notice version they read. Turning features off does not need it."
      >
        I have read this notice and agree to this data use for {propertyName} on behalf of
        my organization.
      </ConsentCheckbox>
      {/* A refusal of the command, not of the checkbox: it ends the body, directly
          above the actions. */}
      <FormErrorBanner error={errorMessage} />
    </CardContent>
  )
}
