import { Fragment } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import type { GoogleImportStep } from './google-import-manager-contract'

/** The flow's four steps; `ai` is the onboarding step after the import lands. */
export type GoogleImportFlowStep = GoogleImportStep | 'ai'

const STEPS: ReadonlyArray<Readonly<{ id: GoogleImportFlowStep; label: string }>> = [
  { id: 'discover', label: 'Select locations' },
  { id: 'review', label: 'Review details' },
  { id: 'progress', label: 'Import' },
  { id: 'ai', label: 'AI analysis' },
]

type Props = Readonly<{
  step: GoogleImportFlowStep
  disabled?: boolean
  onBackToDiscover?: () => void
}>

export function GoogleImportManagerBreadcrumbs({
  step,
  disabled = false,
  onBackToDiscover,
}: Props) {
  return (
    <Breadcrumb aria-label="Import steps">
      <BreadcrumbList>
        {STEPS.map((candidate, index) => (
          <Fragment key={candidate.id}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {candidate.id === step ? (
                <BreadcrumbPage>{candidate.label}</BreadcrumbPage>
              ) : candidate.id === 'discover' && step === 'review' && onBackToDiscover ? (
                <BreadcrumbLink asChild>
                  <button type="button" disabled={disabled} onClick={onBackToDiscover}>
                    {candidate.label}
                  </button>
                </BreadcrumbLink>
              ) : (
                <span>{candidate.label}</span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
