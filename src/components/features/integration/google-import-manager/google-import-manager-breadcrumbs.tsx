import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import type { GoogleImportStep } from './google-import-manager-contract'

type Props = Readonly<{
  step: GoogleImportStep
  disabled: boolean
  onBackToDiscover: () => void
}>

export function GoogleImportManagerBreadcrumbs({
  step,
  disabled,
  onBackToDiscover,
}: Props) {
  const isReview = step === 'review'
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {isReview ? (
            <BreadcrumbLink asChild>
              <button type="button" disabled={disabled} onClick={onBackToDiscover}>
                Select locations
              </button>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>Select locations</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {isReview ? (
            <BreadcrumbPage>Review details</BreadcrumbPage>
          ) : (
            <span>Review details</span>
          )}
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <span>Import</span>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
