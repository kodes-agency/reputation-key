import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import type {
  CurrentMerchantAiCapability,
  MerchantAiState,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { CardContent } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { MerchantAiDataHandling } from './merchant-ai-data-handling'

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
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>Google source unavailable</AlertTitle>
      <AlertDescription>
        <p>
          Connect and confirm this property&apos;s Google Business Profile before enabling
          AI features. Existing authorization can still be turned off.
        </p>
        {canManageGoogleConnection || canConfirmGoogleProperty ? (
          <div className="flex flex-wrap items-center gap-1">
            {canManageGoogleConnection ? (
              <Button asChild size="xs" variant="link">
                <Link to="/settings/integrations">Open Google integrations</Link>
              </Button>
            ) : null}
            {canConfirmGoogleProperty ? (
              <Button asChild size="xs" variant="link">
                <Link to="/properties/import-google">Review property import</Link>
              </Button>
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
          <h2 className="font-semibold">AI features</h2>
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

      <div className="flex flex-col gap-2">
        <Field
          orientation="horizontal"
          className="items-start"
          data-invalid={Boolean(errorMessage)}
        >
          <Checkbox
            id="merchant-ai-acknowledgement"
            className="mt-0.5"
            checked={acknowledged}
            disabled={pending}
            aria-invalid={Boolean(errorMessage)}
            aria-describedby="merchant-ai-acknowledgement-help"
            onCheckedChange={(next) => onAcknowledgedChange(next === true)}
          />
          <FieldLabel htmlFor="merchant-ai-acknowledgement" className="min-w-0">
            I have read this notice and agree to this data use for {propertyName} on
            behalf of my organization.
          </FieldLabel>
        </Field>
        <p
          id="merchant-ai-acknowledgement-help"
          className="text-sm text-muted-foreground"
        >
          Required to enable or change AI features. RepKey records who agreed and the
          notice version they read. Turning features off does not need it.
        </p>
        {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
      </div>
    </CardContent>
  )
}
