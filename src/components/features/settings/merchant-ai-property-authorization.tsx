import { useMemo, useState } from 'react'
import type {
  CurrentMerchantAiCapability,
  MerchantAiSnapshot,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { Action } from '#/components/hooks/use-action'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
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

/**
 * The commands arrive as the caller's Actions, so their success toasts and cache
 * invalidation stay where they were built and in-flight state is read from them.
 */
export type MerchantAiPropertyAuthorizationProps = Readonly<{
  property: MerchantAiPropertyOption
  snapshot: MerchantAiSnapshot
  notice: MerchantAiNoticeDto
  enable: Action<MerchantAiEnableInput, MerchantAiSnapshot>
  change: Action<MerchantAiChangeInput, MerchantAiSnapshot>
  revoke: Action<MerchantAiRevokeInput, MerchantAiSnapshot>
}>

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
}: MerchantAiPropertyAuthorizationProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [acknowledged, setAcknowledged] = useState(false)
  // The refusal stays local rather than read from the Actions' `error`: the
  // caller owns them and keeps them across this section's state-version remount,
  // and an Action has no reset, so an old refusal would outlive a later success.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const pending = enable.isPending || change.isPending || revoke.isPending
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

  // `inCard`: the card says a refusal. Enable and Turn off are confirmed in a
  // dialog that stays open and says it there, so they let it through instead.
  const run = async (operation: () => Promise<MerchantAiSnapshot>, inCard = true) => {
    setErrorMessage(null)
    try {
      const next = await operation()
      setSnapshot(next)
      setSelectedCapabilities(next.capabilities)
    } catch (error) {
      if (!inCard) throw error
      // The server's sentence for a refusal (a changed notice, a stale state
      // version); a generic one for a failure it never wrote for a reader.
      setErrorMessage(actionErrorMessage(error))
    } finally {
      // Every consent is its own acknowledgement: the next one is asked again.
      // Enable's dialog is held back by it, so after a refusal the manager closes
      // the dialog, reads the notice and ticks again.
      setAcknowledged(false)
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
      selectionChanged={selectionChanged}
      onToggleCapability={toggleCapability}
      onAcknowledgedChange={setAcknowledged}
      onResetSelection={() => {
        setSelectedCapabilities(snapshot.capabilities)
        // The tick was given for the choice that is now put back.
        setAcknowledged(false)
      }}
      onEnable={() => run(() => enable({ data: consentData() }), false)}
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
      onRevoke={() => run(() => revoke({ data: commandData() }), false)}
    />
  )
}
