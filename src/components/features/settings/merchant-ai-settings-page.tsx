import { BrainCircuit } from 'lucide-react'
import type { MerchantAiSnapshot } from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { EmptyState } from '#/components/ui/empty-state'
import {
  MerchantAiPropertySelector,
  type MerchantAiPropertyOption,
} from './merchant-ai-settings-content'
import {
  MerchantAiPropertyAuthorization,
  type MerchantAiChangeInput,
  type MerchantAiEnableInput,
  type MerchantAiRevokeInput,
} from './merchant-ai-property-authorization'
import {
  PropertyReplyLanguageCard,
  type PropertyReplyLanguageUpdateAction,
} from './property-reply-language-card'

type Props = Readonly<{
  properties: ReadonlyArray<MerchantAiPropertyOption>
  propertyId?: string
  snapshot: MerchantAiSnapshot | null
  notice: MerchantAiNoticeDto
  onPropertyChange: (propertyId: string) => void
  enable: (input: MerchantAiEnableInput) => Promise<MerchantAiSnapshot>
  change: (input: MerchantAiChangeInput) => Promise<MerchantAiSnapshot>
  revoke: (input: MerchantAiRevokeInput) => Promise<MerchantAiSnapshot>
  updateProperty: PropertyReplyLanguageUpdateAction
}>

export function MerchantAiSettingsPage({
  properties,
  propertyId,
  snapshot,
  notice,
  onPropertyChange,
  enable,
  change,
  revoke,
  updateProperty,
}: Props) {
  const property = properties.find((candidate) => candidate.id === propertyId)

  return (
    <div className="flex w-full min-w-0 max-w-4xl flex-col gap-6">
      <MerchantAiPropertySelector
        properties={properties}
        propertyId={propertyId}
        onPropertyChange={onPropertyChange}
      />

      {property ? (
        <PropertyReplyLanguageCard
          key={`${property.id}:${property.defaultReplyLanguage ?? 'unconfigured'}`}
          property={property}
          updateProperty={updateProperty}
        />
      ) : null}

      {!propertyId || !property || !snapshot ? (
        <EmptyState
          icon={BrainCircuit}
          title="Select a property to manage replies and AI"
        >
          <p className="max-w-md text-sm text-muted-foreground">
            Choose a property to set its reply language and manage AI data use.
          </p>
        </EmptyState>
      ) : (
        <MerchantAiPropertyAuthorization
          key={property.id}
          property={property}
          snapshot={snapshot}
          notice={notice}
          enable={enable}
          change={change}
          revoke={revoke}
        />
      )}
    </div>
  )
}
