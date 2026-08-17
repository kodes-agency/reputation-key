import { AlertTriangle } from 'lucide-react'
import type {
  CurrentMerchantAiCapability,
  MerchantAiState,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { MerchantAiDataHandling } from './merchant-ai-data-handling'

export type MerchantAiPropertyOption = Readonly<{
  id: string
  name: string
  googleBindingState:
    | 'unbound'
    | 'account_confirmation_required'
    | 'active'
    | 'disconnected'
}>

export function MerchantAiPropertySelector({
  properties,
  propertyId,
  onPropertyChange,
}: Readonly<{
  properties: ReadonlyArray<MerchantAiPropertyOption>
  propertyId?: string
  onPropertyChange: (propertyId: string) => void
}>) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle>Property</CardTitle>
        <CardDescription>
          AI data-use authorization is independent for every property.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="merchant-ai-property">Property</FieldLabel>
          <Select value={propertyId} onValueChange={onPropertyChange}>
            <SelectTrigger
              id="merchant-ai-property"
              className="h-11 min-h-11 w-full min-w-0 max-w-full"
              aria-label="Property"
            >
              <SelectValue placeholder="Select a property" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {properties.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
    </Card>
  )
}

export function MerchantAiSettingsContent({
  sourceActive,
  state,
  notice,
  selectedCapabilities,
  password,
  pending,
  errorMessage,
  onToggleCapability,
  onPasswordChange,
}: Readonly<{
  sourceActive: boolean
  state: MerchantAiState
  notice: MerchantAiNoticeDto
  selectedCapabilities: ReadonlyArray<CurrentMerchantAiCapability>
  password: string
  pending: boolean
  errorMessage: string | null
  onToggleCapability: (capability: CurrentMerchantAiCapability, checked: boolean) => void
  onPasswordChange: (password: string) => void
}>) {
  const isEnabled = state === 'enabled'
  const showsInitialEnablement = state === 'disabled' || state === 'revoked'
  const { payload } = notice

  return (
    <CardContent className="flex min-w-0 flex-col gap-6">
      {!sourceActive ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Google source unavailable</AlertTitle>
          <AlertDescription>
            Connect and confirm this property&apos;s Google Business Profile before
            enabling AI features. Existing authorization can still be turned off.
          </AlertDescription>
        </Alert>
      ) : null}

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

      <Field data-invalid={Boolean(errorMessage)}>
        <FieldLabel htmlFor="merchant-ai-password">Confirm with your password</FieldLabel>
        <Input
          id="merchant-ai-password"
          type="password"
          autoComplete="current-password"
          value={password}
          className="min-h-11"
          disabled={pending}
          aria-invalid={Boolean(errorMessage)}
          aria-describedby="merchant-ai-password-help"
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        <p id="merchant-ai-password-help" className="text-sm text-muted-foreground">
          Required for every enable, change, or turn-off action. The password is not
          stored.
        </p>
        {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
      </Field>
    </CardContent>
  )
}
