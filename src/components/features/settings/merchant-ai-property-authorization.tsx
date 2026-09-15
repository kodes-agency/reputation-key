import { useMemo, useState } from 'react'
import type {
  CurrentMerchantAiCapability,
  MerchantAiSnapshot,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { MerchantAiPropertyOption } from './merchant-ai-settings-content'
import { MerchantAiAuthorizationCard } from './merchant-ai-authorization-card'
import { toggleAiCapability } from './merchant-ai-capability-selection'

type CommandData = Readonly<{
  propertyId: string
  expectedStateVersion: number
  idempotencyKey: string
}>

/** A revoke withdraws consent, so it carries no acknowledgement. */
export type MerchantAiRevokeInput = Readonly<{ data: CommandData }>

/** An enable names the notice the merchant acknowledged on screen. */
export type MerchantAiEnableInput = Readonly<{
  data: CommandData &
    Readonly<{
      acknowledgement: Readonly<{ noticeVersion: string; noticeDigest: string }>
    }>
}>

export type MerchantAiChangeInput = Readonly<{
  data: MerchantAiEnableInput['data'] & {
    capabilities: CurrentMerchantAiCapability[]
  }
}>

export type MerchantAiPropertyAuthorizationProps = Readonly<{
  property: MerchantAiPropertyOption
  snapshot: MerchantAiSnapshot
  notice: MerchantAiNoticeDto
  enable: (input: MerchantAiEnableInput) => Promise<MerchantAiSnapshot>
  change: (input: MerchantAiChangeInput) => Promise<MerchantAiSnapshot>
  revoke: (input: MerchantAiRevokeInput) => Promise<MerchantAiSnapshot>
  /** Told about every accepted command, so a surrounding page can refresh. */
  onChanged?: (snapshot: MerchantAiSnapshot) => void
}>

function mutationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The AI setting could not be saved. Reload the property and try again.'
}

/**
 * One property's AI authorization: the capability choice, consent against the
 * served notice, and enable / change / turn off. Rendered by the property's own
 * AI settings section; the property is fixed by the caller.
 */
export function MerchantAiPropertyAuthorization({
  property,
  snapshot: initialSnapshot,
  notice,
  enable,
  change,
  revoke,
  onChanged,
}: MerchantAiPropertyAuthorizationProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    ReadonlyArray<CurrentMerchantAiCapability>
  >(
    initialSnapshot.state === 'enabled'
      ? initialSnapshot.capabilities
      : notice.payload.capabilities.map((capability) => capability.id),
  )

  const state = snapshot.state
  const sourceActive = property.googleBindingState === 'active'
  const selectionChanged = useMemo(
    () =>
      notice.payload.capabilities.some(
        ({ id }) =>
          selectedCapabilities.includes(id) !== snapshot.capabilities.includes(id),
      ),
    [notice.payload.capabilities, selectedCapabilities, snapshot],
  )
  // A re-versioned notice is a real change even when the capability set is
  // identical: consent has to be re-granted against the notice on screen.
  // Mirrors the notice half of `executionContractChanged` in
  // merchant-ai-authorization.repository.ts.
  const contractChanged =
    snapshot.noticeVersion !== notice.version || snapshot.noticeDigest !== notice.digest

  const toggleCapability = (
    capability: CurrentMerchantAiCapability,
    checked: boolean,
  ) => {
    setSelectedCapabilities((current) =>
      toggleAiCapability(
        current,
        capability,
        checked,
        notice.payload.capabilities.map((candidate) => candidate.id),
      ),
    )
  }

  const commandData = () => ({
    propertyId: property.id,
    expectedStateVersion: snapshot.stateVersion,
    idempotencyKey: crypto.randomUUID(),
  })
  // Consent names the notice on screen; the server refuses any other one.
  const consentData = () => ({
    ...commandData(),
    acknowledgement: { noticeVersion: notice.version, noticeDigest: notice.digest },
  })

  const run = async (operation: () => Promise<MerchantAiSnapshot>) => {
    setPending(true)
    setErrorMessage(null)
    try {
      const next = await operation()
      setSnapshot(next)
      setSelectedCapabilities(next.capabilities)
      onChanged?.(next)
    } catch (error) {
      setErrorMessage(mutationErrorMessage(error))
    } finally {
      // Every consent is its own acknowledgement: the next one is asked again.
      setAcknowledged(false)
      setPending(false)
    }
  }

  const canSubmit = Boolean(sourceActive && acknowledged && !pending)

  return (
    <MerchantAiAuthorizationCard
      propertyName={property.name}
      state={state}
      sourceActive={sourceActive}
      notice={notice}
      selectedCapabilities={selectedCapabilities}
      acknowledged={acknowledged}
      pending={pending}
      errorMessage={errorMessage}
      canSubmit={canSubmit}
      canSave={
        canSubmit &&
        (selectionChanged || contractChanged) &&
        selectedCapabilities.length > 0
      }
      onToggleCapability={toggleCapability}
      onAcknowledgedChange={setAcknowledged}
      onEnable={() => void run(() => enable({ data: consentData() }))}
      onChange={() =>
        void run(() =>
          change({
            data: {
              ...consentData(),
              capabilities: [...selectedCapabilities],
            },
          }),
        )
      }
      onRevoke={() => void run(() => revoke({ data: commandData() }))}
    />
  )
}
