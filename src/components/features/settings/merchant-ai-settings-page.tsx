import { useMemo, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import type {
  CurrentMerchantAiCapability,
  MerchantAiSnapshot,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { MerchantAiSettingsActions } from './merchant-ai-settings-actions'
import {
  MerchantAiPropertySelector,
  MerchantAiSettingsContent,
  type MerchantAiPropertyOption,
} from './merchant-ai-settings-content'

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
}>

const STATUS_META = {
  disabled: { label: 'Off', variant: 'secondary' as const },
  enabled: { label: 'On', variant: 'default' as const },
  revoked: { label: 'Off', variant: 'secondary' as const },
}

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
  const isEnabled = state === 'enabled'
  const canRevoke = state === 'enabled'
  const sourceActive = property?.googleBindingState === 'active'
  const selectionChanged = useMemo(() => {
    if (!snapshot) return false
    return notice.payload.capabilities.some(
      ({ id }) =>
        selectedCapabilities.includes(id) !== snapshot.capabilities.includes(id),
    )
  }, [notice.payload.capabilities, selectedCapabilities, snapshot])

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

      {!propertyId || !property || !snapshot ? (
        <EmptyState icon={BrainCircuit} title="Select a property to manage AI data use">
          <p className="max-w-md text-sm text-muted-foreground">
            Nothing is enabled until a manager reviews the notice and confirms with a
            fresh password.
          </p>
        </EmptyState>
      ) : (
        <Card className="min-w-0">
          <CardHeader className="border-b">
            <CardTitle>{notice.payload.title}</CardTitle>
            <CardDescription>{notice.payload.summary}</CardDescription>
            <CardAction>
              <Badge variant={STATUS_META[state].variant}>
                {STATUS_META[state].label}
              </Badge>
            </CardAction>
          </CardHeader>

          <MerchantAiSettingsContent
            sourceActive={sourceActive}
            state={state}
            notice={notice}
            selectedCapabilities={selectedCapabilities}
            password={password}
            pending={pending}
            errorMessage={errorMessage}
            onToggleCapability={toggleCapability}
            onPasswordChange={setPassword}
          />
          <MerchantAiSettingsActions
            propertyName={property.name}
            canRevoke={canRevoke}
            isEnabled={isEnabled}
            canEnable={canSubmit}
            canSave={canSubmit && selectionChanged && selectedCapabilities.length > 0}
            passwordPresent={Boolean(password)}
            pending={pending}
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
        </Card>
      )}
    </div>
  )
}
