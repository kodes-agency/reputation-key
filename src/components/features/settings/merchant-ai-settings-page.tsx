import { useMemo, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import type {
  CurrentMerchantAiCapability,
  MerchantAiSnapshot,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { EmptyState } from '#/components/ui/empty-state'
import {
  MerchantAiPropertySelector,
  type MerchantAiPropertyOption,
} from './merchant-ai-settings-content'
import { MerchantAiAuthorizationCard } from './merchant-ai-authorization-card'
import {
  PropertyReplyLanguageCard,
  type PropertyReplyLanguageUpdateAction,
} from './property-reply-language-card'

type CommandInput = Readonly<{
  data: Readonly<{
    propertyId: string
    expectedStateVersion: number
    idempotencyKey: string
    password: string
  }>
}>

type ChangeInput = Readonly<{
  data: CommandInput['data'] & {
    capabilities: CurrentMerchantAiCapability[]
  }
}>

type Props = Readonly<{
  properties: ReadonlyArray<MerchantAiPropertyOption>
  propertyId?: string
  snapshot: MerchantAiSnapshot | null
  notice: MerchantAiNoticeDto
  onPropertyChange: (propertyId: string) => void
  enable: (input: CommandInput) => Promise<MerchantAiSnapshot>
  change: (input: ChangeInput) => Promise<MerchantAiSnapshot>
  revoke: (input: CommandInput) => Promise<MerchantAiSnapshot>
  updateProperty: PropertyReplyLanguageUpdateAction
}>

function mutationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The AI setting could not be saved. Reload the property and try again.'
}

export function MerchantAiSettingsPage({
  properties,
  propertyId,
  snapshot: initialSnapshot,
  notice,
  onPropertyChange,
  enable,
  change,
  revoke,
  updateProperty,
}: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    ReadonlyArray<CurrentMerchantAiCapability>
  >(
    initialSnapshot?.state === 'enabled'
      ? initialSnapshot.capabilities
      : notice.payload.capabilities.map((capability) => capability.id),
  )

  const property = properties.find((candidate) => candidate.id === propertyId)
  const state = snapshot?.state ?? 'disabled'
  const sourceActive = property?.googleBindingState === 'active'
  const selectionChanged = useMemo(() => {
    if (!snapshot) return false
    return notice.payload.capabilities.some(
      ({ id }) =>
        selectedCapabilities.includes(id) !== snapshot.capabilities.includes(id),
    )
  }, [notice.payload.capabilities, selectedCapabilities, snapshot])
  // A re-versioned notice is a real change even when the capability set is
  // identical: the server's `executionContractChanged` accepts it, and consent
  // has to be re-granted against the notice actually on screen. Without this the
  // Save button stays disabled and the only way through is to drop a capability
  // and re-add it — which revokes it briefly, writes an extra evidence row and
  // bumps that capability's epoch twice. Mirrors the notice half of
  // `executionContractChanged` in merchant-ai-authorization.repository.ts.
  const contractChanged =
    snapshot !== null &&
    (snapshot.noticeVersion !== notice.version || snapshot.noticeDigest !== notice.digest)

  const toggleCapability = (
    capability: CurrentMerchantAiCapability,
    checked: boolean,
  ) => {
    setSelectedCapabilities((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(capability)
        if (capability === 'property_trends') next.add('review_analysis')
      } else {
        next.delete(capability)
        if (capability === 'review_analysis') next.delete('property_trends')
      }
      return notice.payload.capabilities
        .map((candidate) => candidate.id)
        .filter((candidate) => next.has(candidate))
    })
  }

  const commandData = () => ({
    propertyId: propertyId!,
    expectedStateVersion: snapshot?.stateVersion ?? 0,
    idempotencyKey: crypto.randomUUID(),
    password,
  })

  const run = async (operation: () => Promise<MerchantAiSnapshot>) => {
    setPending(true)
    setErrorMessage(null)
    try {
      const next = await operation()
      setSnapshot(next)
      setSelectedCapabilities(next.capabilities)
    } catch (error) {
      setErrorMessage(mutationErrorMessage(error))
    } finally {
      setPassword('')
      setPending(false)
    }
  }

  const canSubmit = Boolean(propertyId && sourceActive && password && !pending)

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
        <MerchantAiAuthorizationCard
          propertyName={property.name}
          state={state}
          sourceActive={sourceActive}
          notice={notice}
          selectedCapabilities={selectedCapabilities}
          password={password}
          pending={pending}
          errorMessage={errorMessage}
          canSubmit={canSubmit}
          canSave={
            canSubmit &&
            (selectionChanged || contractChanged) &&
            selectedCapabilities.length > 0
          }
          onToggleCapability={toggleCapability}
          onPasswordChange={setPassword}
          onEnable={() => void run(() => enable({ data: commandData() }))}
          onChange={() =>
            void run(() =>
              change({
                data: {
                  ...commandData(),
                  capabilities: [...selectedCapabilities],
                },
              }),
            )
          }
          onRevoke={() => void run(() => revoke({ data: commandData() }))}
        />
      )}
    </div>
  )
}
