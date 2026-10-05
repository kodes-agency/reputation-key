import type {
  CurrentMerchantAiCapability,
  MerchantAiState,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { renderMerchantAiNoticeCta } from '#/shared/merchant-ai-notice-contract'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { MerchantAiSettingsActions } from './merchant-ai-settings-actions'
import { MerchantAiSettingsContent } from './merchant-ai-settings-content'

const AI_STATE_STATUS: StatusMap<MerchantAiState> = {
  disabled: { label: 'Off', tone: 'neutral' },
  enabled: { label: 'On', tone: 'positive' },
  revoked: { label: 'Off', tone: 'neutral' },
}

type Props = Readonly<{
  propertyName: string
  state: MerchantAiState
  sourceActive: boolean
  notice: MerchantAiNoticeDto
  selectedCapabilities: ReadonlyArray<CurrentMerchantAiCapability>
  acknowledged: boolean
  pending: boolean
  errorMessage: string | null
  canSubmit: boolean
  canSave: boolean
  selectionChanged: boolean
  onToggleCapability: (capability: CurrentMerchantAiCapability, checked: boolean) => void
  onAcknowledgedChange: (acknowledged: boolean) => void
  onEnable: () => Promise<unknown>
  onChange: () => void
  onRevoke: () => Promise<unknown>
  onResetSelection: () => void
}>

export function MerchantAiAuthorizationCard(props: Props) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle>{props.notice.payload.title}</CardTitle>
        <CardDescription>{props.notice.payload.summary}</CardDescription>
        <CardAction>
          <StatusBadge status={props.state} map={AI_STATE_STATUS} />
        </CardAction>
      </CardHeader>

      <MerchantAiSettingsContent
        propertyName={props.propertyName}
        sourceActive={props.sourceActive}
        state={props.state}
        notice={props.notice}
        selectedCapabilities={props.selectedCapabilities}
        acknowledged={props.acknowledged}
        pending={props.pending}
        errorMessage={props.errorMessage}
        onToggleCapability={props.onToggleCapability}
        onAcknowledgedChange={props.onAcknowledgedChange}
      />
      <MerchantAiSettingsActions
        propertyName={props.propertyName}
        enableCallToAction={renderMerchantAiNoticeCta(props.notice.payload, [
          props.propertyName,
        ])}
        canRevoke={props.state === 'enabled'}
        isEnabled={props.state === 'enabled'}
        canEnable={props.canSubmit}
        canSave={props.canSave}
        selectionChanged={props.selectionChanged}
        pending={props.pending}
        onEnable={props.onEnable}
        onChange={props.onChange}
        onRevoke={props.onRevoke}
        onResetSelection={props.onResetSelection}
      />
    </Card>
  )
}
