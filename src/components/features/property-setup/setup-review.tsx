import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { MerchantAiDataHandling } from '#/components/features/settings/merchant-ai-data-handling'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { BackButton } from '#/components/ui/back-link'
import { Button } from '#/components/ui/button'
import { ConsentCheckbox } from '#/components/forms/consent-checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { SetupMember } from './property-setup-contract'
import {
  aiEnabledProperties,
  type PropertySetupPlan,
  type SetupPlan,
  type SetupPropertyFacts,
} from './setup-plan'
import { memberLabel, replyLanguageLabel } from './setup-summaries'

type Props = Readonly<{
  plan: SetupPlan
  facts: readonly SetupPropertyFacts[]
  members: ReadonlyMap<string, SetupMember>
  notice: MerchantAiNoticeDto
  acknowledged: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  saving: boolean
  onBack: () => void
  onSave: () => void
}>

const NOT_ASKED = 'Already set'
const SKIPPED = 'Skipped'

function displayNameCell(
  entry: PropertySetupPlan,
  facts: SetupPropertyFacts | undefined,
) {
  if (entry.displayName) return entry.displayName
  return facts?.publicDisplayNameConfirmed ? NOT_ASKED : SKIPPED
}

function languageCell(entry: PropertySetupPlan, facts: SetupPropertyFacts | undefined) {
  if (entry.language) return replyLanguageLabel(entry.language)
  return facts?.replyLanguage ? NOT_ASKED : SKIPPED
}

function managerCell(
  entry: PropertySetupPlan,
  facts: SetupPropertyFacts | undefined,
  members: ReadonlyMap<string, SetupMember>,
) {
  if (entry.managerIds) {
    return entry.managerIds.map((userId) => memberLabel(members, userId)).join(', ')
  }
  if (facts && facts.managerIds.length > 0) return NOT_ASKED
  if (facts && facts.eligibleManagerIds.length === 0) return 'Nobody eligible yet'
  return SKIPPED
}

function aiCell(
  entry: PropertySetupPlan,
  facts: SetupPropertyFacts | undefined,
  plan: SetupPlan,
  notice: MerchantAiNoticeDto,
) {
  if (entry.ai === 'defer') return 'Not now'
  if (entry.ai === 'enable') {
    const titles = new Map(
      notice.payload.capabilities.map((capability) => [capability.id, capability.title]),
    )
    return `On: ${plan.aiCapabilities.map((id) => titles.get(id) ?? id).join(', ')}`
  }
  return facts?.aiDecided ? 'Already decided' : SKIPPED
}

function replyVoiceCell(entry: PropertySetupPlan, facts: SetupPropertyFacts | undefined) {
  if (entry.replyVoice) {
    return entry.replyVoice.emojiMode === 'positive'
      ? 'Set · emoji in positive replies'
      : 'Set · emoji off'
  }
  return facts?.replyVoiceConfigured ? NOT_ASKED : SKIPPED
}

/**
 * The one acknowledgement of a consent ceremony, naming every property it
 * covers: one in its sentence, several as a list under it. The call to action
 * names none (merchant-ai-notice-2026-10-17.v1), so this is where a manager
 * reads what they agree for.
 */
function AiAcknowledgement({
  properties,
  acknowledged,
  saving,
  onAcknowledgedChange,
}: Readonly<{
  properties: readonly PropertySetupPlan[]
  acknowledged: boolean
  saving: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
}>) {
  const several = properties.length > 1
  return (
    <ConsentCheckbox
      id="setup-ai-acknowledgement"
      checked={acknowledged}
      disabled={saving}
      onCheckedChange={onAcknowledgedChange}
      description="Required to enable AI features. RepKey records who agreed and the notice version they read."
      listed={
        several
          ? properties.map((property) => ({
              key: property.propertyId,
              label: property.propertyName,
            }))
          : undefined
      }
    >
      {several
        ? `I have read this notice and agree to this data use on behalf of my organization for these ${properties.length} properties:`
        : `I have read this notice and agree to this data use for ${properties[0]?.propertyName} on behalf of my organization.`}
    </ConsentCheckbox>
  )
}

/**
 * What will be saved for every property, and, when AI is turned on, the
 * consent ceremony (decisions 3 and 4): the served notice, one explicit
 * acknowledgement naming every property, and the notice's call to action.
 */
export function SetupReview({
  plan,
  facts,
  members,
  notice,
  acknowledged,
  onAcknowledgedChange,
  saving,
  onBack,
  onSave,
}: Props) {
  const factsById = new Map(facts.map((property) => [property.propertyId, property]))
  const aiProperties = aiEnabledProperties(plan)
  const consentNeeded = aiProperties.length > 0
  const nothingToSave = plan.properties.every(
    (entry) =>
      entry.displayName === null &&
      entry.language === null &&
      entry.managerIds === null &&
      entry.ai === null &&
      entry.replyVoice == null,
  )

  return (
    <section aria-labelledby="setup-review-title" className="flex flex-col gap-5">
      <div>
        <h3 id="setup-review-title" className="text-lg font-semibold tracking-tight">
          Review and save
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Skipped answers stay on each property&apos;s setup checklist.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Property</TableHead>
              <TableHead scope="col">Public display name</TableHead>
              <TableHead scope="col">Reply language</TableHead>
              <TableHead scope="col">Responsible manager</TableHead>
              <TableHead scope="col">AI features</TableHead>
              <TableHead scope="col">Reply voice</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.properties.map((entry) => {
              const property = factsById.get(entry.propertyId)
              return (
                <TableRow key={entry.propertyId}>
                  <TableHead scope="row" className="font-medium">
                    {entry.propertyName}
                  </TableHead>
                  <TableCell className="whitespace-normal">
                    {displayNameCell(entry, property)}
                  </TableCell>
                  <TableCell>{languageCell(entry, property)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {managerCell(entry, property, members)}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {aiCell(entry, property, plan, notice)}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {replyVoiceCell(entry, property)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {consentNeeded ? (
        <section aria-labelledby="setup-ai-notice-title" className="flex flex-col gap-5">
          <div>
            <h4 id="setup-ai-notice-title" className="font-semibold">
              {notice.payload.title}
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">{notice.payload.summary}</p>
          </div>
          <MerchantAiDataHandling notice={notice} />
          <AiAcknowledgement
            properties={aiProperties}
            acknowledged={acknowledged}
            saving={saving}
            onAcknowledgedChange={onAcknowledgedChange}
          />
        </section>
      ) : null}

      {nothingToSave ? (
        <Alert variant="info">
          <AlertTitle>Nothing to save</AlertTitle>
          <AlertDescription>
            Every question was skipped. Go back to answer them, or finish later from each
            property&apos;s setup checklist.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <BackButton label="Back to questions" disabled={saving} onClick={onBack} />
        <Button
          type="button"
          pending={saving}
          disabled={nothingToSave || (consentNeeded && !acknowledged)}
          onClick={onSave}
        >
          {consentNeeded ? notice.payload.ctaTemplate : 'Save setup'}
        </Button>
      </div>
    </section>
  )
}
