import { Loader2 } from 'lucide-react'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { MerchantAiDataHandling } from '#/components/features/settings/merchant-ai-data-handling'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel } from '#/components/ui/field'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  formatMerchantAiPropertyNames,
  renderMerchantAiNoticeCta,
} from '#/shared/merchant-ai-notice-contract'
import type { SetupMember } from './property-setup-contract'
import {
  aiEnabledPropertyNames,
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
  const aiNames = aiEnabledPropertyNames(plan)
  const consentNeeded = aiNames.length > 0
  const nothingToSave = plan.properties.every(
    (entry) =>
      entry.displayName === null &&
      entry.language === null &&
      entry.managerIds === null &&
      entry.ai === null,
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
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {consentNeeded ? (
        <section
          aria-labelledby="setup-ai-notice-title"
          className="flex flex-col gap-5 rounded-xl border p-4 sm:p-6"
        >
          <div>
            <h4 id="setup-ai-notice-title" className="font-semibold">
              {notice.payload.title}
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">{notice.payload.summary}</p>
          </div>
          <MerchantAiDataHandling notice={notice} />
          <Field orientation="horizontal" className="items-start">
            <Checkbox
              id="setup-ai-acknowledgement"
              className="mt-0.5"
              checked={acknowledged}
              disabled={saving}
              onCheckedChange={(checked) => onAcknowledgedChange(checked === true)}
            />
            <FieldLabel htmlFor="setup-ai-acknowledgement" className="min-w-0">
              I have read this notice and agree to this data use for{' '}
              {formatMerchantAiPropertyNames(aiNames)} on behalf of my organization.
            </FieldLabel>
          </Field>
        </section>
      ) : null}

      {nothingToSave ? (
        <Alert>
          <AlertTitle>Nothing to save</AlertTitle>
          <AlertDescription>
            Every question was skipped. Go back to answer them, or finish later from each
            property&apos;s setup checklist.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" disabled={saving} onClick={onBack}>
          Back to questions
        </Button>
        <Button
          type="button"
          className="h-auto min-h-9 whitespace-normal text-balance"
          disabled={saving || nothingToSave || (consentNeeded && !acknowledged)}
          onClick={onSave}
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {consentNeeded
            ? renderMerchantAiNoticeCta(notice.payload, aiNames)
            : 'Save setup'}
        </Button>
      </div>
    </section>
  )
}
